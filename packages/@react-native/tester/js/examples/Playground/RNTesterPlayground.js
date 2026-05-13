/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Repurposed for https://github.com/microsoft/react-native-windows/issues/16047.
 *
 * Three side-by-side scrolling regions (ScrollView, FlatList, VirtualizedList)
 * each holding 30 TouchableHighlight rows, plus a control grid of
 * TouchableHighlights outside any scroll region. After a touch-screen scroll
 * the originally-pressed Pressable can be left visually stuck and subsequent
 * taps are misattributed to that stale target.
 *
 * The on-screen event log mirrors the C++ `[RNW Touch]` traces emitted by
 * CompositionEventHandler / CompositionContextHelper so a captured trace and
 * a captured screen recording line up frame-by-frame. The "STUCK PRESS" pill
 * turns red when any row has fired pressIn but has not seen a matching
 * pressOut/release within 5 seconds — the visible sign of the zombie touch
 * in m_activeTouches.
 *
 * @flow strict-local
 * @format
 */

import type {RNTesterModuleExample} from '../../types/RNTesterTypes';

import * as React from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableHighlight,
  View,
  VirtualizedList,
} from 'react-native';

const ROWS: $ReadOnlyArray<string> = Array.from(
  {length: 30},
  (_, i) => `Item ${i + 1}`,
);
const MAX_LOG_LINES = 80;
const STUCK_PRESS_THRESHOLD_MS = 5000;

// Bumped on every meaningful native fix iteration so we can be sure the bundle
// + native binary you're running actually contains the latest code. If you see
// the marker in the log AND see [RNW Touch] CancelTouchesForPointer lines in
// DebugView, both halves of the fix are in this build.
const FIX_BUILD_MARKER =
  'FIX-16047-v6: contentOffset stored as DIPs (was physical pixels) — fixes high-DPI stale measure()';

type LogEntry = {
  id: number,
  t: number,
  text: string,
};

type Counters = {
  touchStart: number,
  touchEnd: number,
  touchCancel: number,
  pressIn: number,
  pressOut: number,
  press: number,
  // Press events that came AFTER at least one touchcancel was observed —
  // this is the count we expect to grow if the post-cancel responder state
  // is healthy. If touchCancel > 0 but pressAfterCancel === 0 across several
  // attempts, the responder system is wedged in JS even though the native
  // cancel made the round trip.
  pressInAfterCancel: number,
  pressAfterCancel: number,
};

type State = {
  toggled: {[string]: boolean},
  log: $ReadOnlyArray<LogEntry>,
  pendingPressIns: {[string]: number},
  stuckCount: number,
  startedAt: number,
  counters: Counters,
  // Identifiers seen in touchcancel events but not yet seen ending naturally
  // (touchend) afterwards. If a touchstart arrives carrying one of these, RN
  // is being asked to start a new gesture on an identifier whose previous
  // cancel hasn't been fully cleaned up — that's the failure pattern in
  // issue #16047 (cancelled id=4 immediately reused for the next press, which
  // then bails synchronously out of pressIn → pressOut held 0ms).
  recentlyCancelledIdentifiers: $ReadOnlyArray<number>,
  identifierReuseCount: number,
};

type ColumnKind = 'sv' | 'fl' | 'vl' | 'ctl';

function rowKey(column: ColumnKind, index: number): string {
  return `${column}-${index}`;
}

const ZERO_COUNTERS: Counters = {
  touchStart: 0,
  touchEnd: 0,
  touchCancel: 0,
  pressIn: 0,
  pressOut: 0,
  press: 0,
  pressInAfterCancel: 0,
  pressAfterCancel: 0,
};

class TouchScrollDiagnostic extends React.Component<{||}, State> {
  nextLogId: number = 1;
  stuckTimer: ?IntervalID;
  // Refs to each row's TouchableHighlight so we can call .measure() on
  // pressIn and verify whether JS thinks the touch position falls inside the
  // row's measured page-space bounds. The leading hypothesis for the post-
  // scroll "press never fires" case is that JS Pressability's measured
  // responder region is stale (the InteractionTracker scrolled the visual
  // layer but Fabric layout for the row didn't catch up before the press),
  // which causes Pressability to fire LEAVE_PRESS_RECT synchronously inside
  // pressIn → state goes to ACTIVE_PRESS_OUT → pressOut(0ms) → no press.
  rowRefs: {[string]: ?$FlowFixMe} = {};
  // Most recent touchstart's pageX/pageY — captured in onTouchStart and
  // referenced in handlePressIn so we know what coords to compare bounds
  // against. This is the actual coordinate the OS reported, which is the
  // same one Pressability's bounds check uses.
  lastTouchPageX: ?number = null;
  lastTouchPageY: ?number = null;

  state: State = {
    toggled: {},
    log: [],
    pendingPressIns: {},
    stuckCount: 0,
    startedAt: Date.now(),
    counters: {...ZERO_COUNTERS},
    recentlyCancelledIdentifiers: [],
    identifierReuseCount: 0,
  };

  componentDidMount(): void {
    this.stuckTimer = setInterval(this.evaluateStuck, 500);
    // High-visibility build marker. If you don't see this on mount the JS
    // bundle is stale (Metro served an old version). If you see this BUT
    // don't see CancelTouchesForPointer lines in DebugView, the C++ binary
    // is stale.
    this.appendLog(`[BUILD] ${FIX_BUILD_MARKER}`);
    // eslint-disable-next-line no-console
    console.log(`[BUILD] ${FIX_BUILD_MARKER}`);
    this.appendLog('[mounted] stuck-press detector running every 500ms');
  }

  componentWillUnmount(): void {
    if (this.stuckTimer != null) {
      clearInterval(this.stuckTimer);
    }
  }

  appendLog: (text: string) => void = (text: string) => {
    this.setState(prev => {
      const entry: LogEntry = {
        id: this.nextLogId++,
        t: Date.now() - prev.startedAt,
        text,
      };
      const next = [entry, ...prev.log];
      if (next.length > MAX_LOG_LINES) {
        next.length = MAX_LOG_LINES;
      }
      return {log: next};
    });
  };

  // Bump a single counter without cloning the whole counters object twice. Also
  // mirrors to console so the line shows up in Metro / RN DevTools, which makes
  // it easy to confirm that JS sees an event even if the on-screen log scrolls.
  bumpCounter: (key: $Keys<Counters>, mirrorText?: string) => void = (
    key: $Keys<Counters>,
    mirrorText?: string,
  ) => {
    this.setState(prev => ({
      counters: {...prev.counters, [key]: prev.counters[key] + 1},
    }));
    if (mirrorText != null) {
      // eslint-disable-next-line no-console
      console.log(`[RNW Touch JS] ${mirrorText}`);
    }
  };

  evaluateStuck: () => void = () => {
    const now = Date.now();
    let stuck = 0;
    for (const key of Object.keys(this.state.pendingPressIns)) {
      const start = this.state.pendingPressIns[key];
      if (now - start > STUCK_PRESS_THRESHOLD_MS) {
        stuck++;
      }
    }
    if (stuck !== this.state.stuckCount) {
      this.setState({stuckCount: stuck});
      if (stuck > 0) {
        this.appendLog(
          `[STUCK] ${stuck} pressIn(s) without matching pressOut > ${STUCK_PRESS_THRESHOLD_MS}ms — likely zombie touch`,
        );
      }
    }
  };

  // Touches array on the native event has no Flow strict typing in RN core;
  // accept the ambient shape and pull out only what we need.
  formatTouchList: (touches: ?Array<$FlowFixMe>) => string = (
    touches: ?Array<$FlowFixMe>,
  ) => {
    if (touches == null || touches.length === 0) {
      return '(none)';
    }
    return touches
      .map(
        x =>
          `id=${x.identifier} target=${x.target} pos=(${Math.round(
            x.pageX,
          )},${Math.round(x.pageY)})`,
      )
      .join(' | ');
  };

  // Format both `touches` (currently active) and `changedTouches` (what changed
  // in this event). For a cancel the cancelled touch lives in changedTouches —
  // logging only `touches` (which is the post-cancel snapshot) hides exactly
  // which native pointer was cancelled.
  formatTouches: (e: $FlowFixMe) => string = (e: $FlowFixMe) => {
    const touches: Array<$FlowFixMe> = e?.nativeEvent?.touches ?? [];
    const changed: Array<$FlowFixMe> = e?.nativeEvent?.changedTouches ?? [];
    return `touches=[${this.formatTouchList(touches)}] changed=[${this.formatTouchList(
      changed,
    )}]`;
  };

  // Pull the identifier(s) out of an event's changedTouches. RN exposes touches
  // and changedTouches; for our purposes (cancel/start identifier collision
  // detection) changedTouches is the right list.
  changedIdentifiers: (e: $FlowFixMe) => Array<number> = (e: $FlowFixMe) => {
    const changed: Array<$FlowFixMe> = e?.nativeEvent?.changedTouches ?? [];
    const ids: Array<number> = [];
    for (const t of changed) {
      if (typeof t?.identifier === 'number') {
        ids.push(t.identifier);
      }
    }
    return ids;
  };

  onTouchStart: (e: $FlowFixMe) => void = (e: $FlowFixMe) => {
    this.bumpCounter('touchStart');
    const ids = this.changedIdentifiers(e);
    // Capture the touch coordinates so handlePressIn can verify them against
    // the row's measured bounds. We use changedTouches[0] because for a
    // touchstart that's the touch that just started.
    const changed: Array<$FlowFixMe> = e?.nativeEvent?.changedTouches ?? [];
    if (changed.length > 0) {
      const t = changed[0];
      if (typeof t?.pageX === 'number') {
        this.lastTouchPageX = t.pageX;
      }
      if (typeof t?.pageY === 'number') {
        this.lastTouchPageY = t.pageY;
      }
    }
    this.appendLog(`[RNW Touch JS] touchstart ${this.formatTouches(e)}`);
    // Identifier collision check. Anything in recentlyCancelledIdentifiers that
    // shows up here is the failure pattern from #16047 (cancel id=N immediately
    // followed by touchstart id=N → Pressability bails synchronously).
    this.setState(prev => {
      const reused = ids.filter(id =>
        prev.recentlyCancelledIdentifiers.includes(id),
      );
      if (reused.length === 0) {
        return null;
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[RNW Touch JS] !!! IDENTIFIER REUSE detected — cancelled ids ${reused.join(
          ',',
        )} are being reused for a new touchstart. This reproduces #16047.`,
      );
      this.appendLog(
        `[RNW Touch JS] !!! IDENTIFIER REUSE id=${reused.join(',')} (cancel→start collision)`,
      );
      const remaining = prev.recentlyCancelledIdentifiers.filter(
        id => !reused.includes(id),
      );
      return {
        recentlyCancelledIdentifiers: remaining,
        identifierReuseCount: prev.identifierReuseCount + reused.length,
      };
    });
  };

  onTouchEnd: (e: $FlowFixMe) => void = (e: $FlowFixMe) => {
    this.bumpCounter('touchEnd');
    const ids = this.changedIdentifiers(e);
    this.appendLog(`[RNW Touch JS] touchend ${this.formatTouches(e)}`);
    // A natural touchend retires the identifier from "recently cancelled"
    // tracking — it means the gesture wound down on its own and the next press
    // with the same id is no longer a cancel→start collision.
    this.setState(prev => {
      if (prev.recentlyCancelledIdentifiers.length === 0) {
        return null;
      }
      const remaining = prev.recentlyCancelledIdentifiers.filter(
        id => !ids.includes(id),
      );
      if (remaining.length === prev.recentlyCancelledIdentifiers.length) {
        return null;
      }
      return {recentlyCancelledIdentifiers: remaining};
    });
  };

  onTouchCancel: (e: $FlowFixMe) => void = (e: $FlowFixMe) => {
    // High-visibility cancel logging — this is the single most important signal
    // proving the InteractingStateEntered -> CancelTouchesForPointer path made
    // the round trip into JS. If you see this line right after a scroll begins,
    // the native fix is live.
    this.bumpCounter(
      'touchCancel',
      `>>>>> NATIVE CANCEL DELIVERED TO JS  ${this.formatTouches(e)} <<<<<`,
    );
    const ids = this.changedIdentifiers(e);
    this.appendLog(
      `[RNW Touch JS] >>> touchcancel (native cancel reached JS) ${this.formatTouches(e)}`,
    );
    // Track these ids so the next touchstart can flag a collision if they're
    // immediately reused.
    this.setState(prev => {
      if (ids.length === 0) {
        return null;
      }
      const merged = prev.recentlyCancelledIdentifiers.slice();
      for (const id of ids) {
        if (!merged.includes(id)) {
          merged.push(id);
        }
      }
      return {recentlyCancelledIdentifiers: merged};
    });
  };

  handlePressIn: (
    e: $FlowFixMe,
    column: ColumnKind,
    index: number,
  ) => void = (e: $FlowFixMe, column: ColumnKind, index: number) => {
    const key = rowKey(column, index);
    this.setState(prev => ({
      pendingPressIns: {...prev.pendingPressIns, [key]: Date.now()},
      counters: {
        ...prev.counters,
        pressIn: prev.counters.pressIn + 1,
        pressInAfterCancel:
          prev.counters.touchCancel > 0
            ? prev.counters.pressInAfterCancel + 1
            : prev.counters.pressInAfterCancel,
      },
    }));
    this.appendLog(`[RNW Touch JS] pressIn ${key}`);
    // Pull touch coords from THIS press event, not from the root onTouchStart
    // capture. Pressability's onResponderGrant (which invokes onPressIn) fires
    // BEFORE the touch event bubbles to the root, so a root-handler-captured
    // pageX/pageY is one tap stale. event.nativeEvent.pageX/pageY here is
    // exactly the touch coordinate Pressability used to grant the responder.
    const ne = e?.nativeEvent;
    let touchX: ?number =
      typeof ne?.pageX === 'number' ? ne.pageX : null;
    let touchY: ?number =
      typeof ne?.pageY === 'number' ? ne.pageY : null;
    // Fall back to changedTouches[0] if pageX/Y aren't surfaced directly
    // (varies by event type / RN version).
    if ((touchX == null || touchY == null) && Array.isArray(ne?.changedTouches) && ne.changedTouches.length > 0) {
      const t = ne.changedTouches[0];
      if (touchX == null && typeof t?.pageX === 'number') {
        touchX = t.pageX;
      }
      if (touchY == null && typeof t?.pageY === 'number') {
        touchY = t.pageY;
      }
    }
    // measure() is async; the result lands a frame or two after pressIn but
    // Pressability's _measureResponderRegion runs the exact same UIManager
    // .measure path on the same view, so whatever bounds we get here are
    // what Pressability gets. If the touch coords fall outside these bounds
    // that explains a synchronous pressOut(0ms): Pressability's
    // onResponderMove will fire LEAVE_PRESS_RECT (state ACTIVE_PRESS_IN ->
    // ACTIVE_PRESS_OUT) before touchend, suppressing the press.
    const ref = this.rowRefs[key];
    if (ref != null && typeof ref.measure === 'function') {
      ref.measure(
        (
          _x: number,
          _y: number,
          width: number,
          height: number,
          pageX: number,
          pageY: number,
        ) => {
          const left = pageX;
          const top = pageY;
          const right = pageX + width;
          const bottom = pageY + height;
          const inside =
            touchX != null &&
            touchY != null &&
            touchX >= left &&
            touchX <= right &&
            touchY >= top &&
            touchY <= bottom;
          const tag =
            touchX != null && touchY != null
              ? inside
                ? 'INSIDE bounds'
                : '!!! OUTSIDE bounds — explains pressOut(0ms) / no-press'
              : '(no touch coords captured)';
          this.appendLog(
            `[RNW Touch JS] measure ${key} bounds=(${Math.round(
              left,
            )},${Math.round(top)})-(${Math.round(right)},${Math.round(
              bottom,
            )}) touch=(${touchX != null ? Math.round(touchX) : '?'},${
              touchY != null ? Math.round(touchY) : '?'
            }) ${tag}`,
          );
          if (touchX != null && touchY != null && !inside) {
            // eslint-disable-next-line no-console
            console.warn(
              `[RNW Touch JS] !!! STALE LAYOUT — measured bounds for ${key} (${Math.round(
                left,
              )},${Math.round(top)})-(${Math.round(right)},${Math.round(
                bottom,
              )}) do NOT contain touch (${Math.round(touchX)},${Math.round(
                touchY,
              )}). Pressability will LEAVE_PRESS_RECT and suppress press.`,
            );
          }
        },
      );
    } else {
      this.appendLog(`[RNW Touch JS] measure ${key} SKIP (no ref / no measure)`);
    }
  };

  handlePressOut: (column: ColumnKind, index: number) => void = (
    column: ColumnKind,
    index: number,
  ) => {
    const key = rowKey(column, index);
    this.setState(prev => {
      const counters = {
        ...prev.counters,
        pressOut: prev.counters.pressOut + 1,
      };
      if (!(key in prev.pendingPressIns)) {
        return {counters};
      }
      const start = prev.pendingPressIns[key];
      const next = {...prev.pendingPressIns};
      delete next[key];
      // Log the pressIn -> pressOut delta so we can spot suspiciously short
      // taps that React Native's gesture detector might be classifying as
      // "drift / not a press" and therefore suppressing the press event.
      this.appendLog(
        `[RNW Touch JS] pressOut ${key} (held ${Date.now() - start}ms)`,
      );
      return {pendingPressIns: next, counters};
    });
  };

  handlePress: (column: ColumnKind, index: number) => void = (
    column: ColumnKind,
    index: number,
  ) => {
    const key = rowKey(column, index);
    this.setState(prev => ({
      toggled: {...prev.toggled, [key]: !prev.toggled[key]},
      counters: {
        ...prev.counters,
        press: prev.counters.press + 1,
        pressAfterCancel:
          prev.counters.touchCancel > 0
            ? prev.counters.pressAfterCancel + 1
            : prev.counters.pressAfterCancel,
      },
    }));
    this.appendLog(`[RNW Touch JS] press ${key}`);
  };

  renderRow: (column: ColumnKind, item: string, index: number) => React.Node = (
    column: ColumnKind,
    item: string,
    index: number,
  ) => {
    const key = rowKey(column, index);
    const isToggled = !!this.state.toggled[key];
    const hasPendingPressIn = key in this.state.pendingPressIns;
    return (
      <TouchableHighlight
        key={key}
        ref={(r: ?$FlowFixMe) => {
          this.rowRefs[key] = r;
        }}
        style={[
          styles.row,
          isToggled && styles.rowToggled,
          hasPendingPressIn && styles.rowPending,
        ]}
        onPressIn={(e: $FlowFixMe) => this.handlePressIn(e, column, index)}
        onPressOut={() => this.handlePressOut(column, index)}
        onPress={() => this.handlePress(column, index)}>
        <Text style={[styles.rowText, isToggled && styles.rowTextToggled]}>
          {item}
        </Text>
      </TouchableHighlight>
    );
  };

  clearLog: () => void = () => {
    this.setState({
      log: [],
      pendingPressIns: {},
      stuckCount: 0,
      startedAt: Date.now(),
      counters: {...ZERO_COUNTERS},
      recentlyCancelledIdentifiers: [],
      identifierReuseCount: 0,
    });
    this.appendLog(`[BUILD] ${FIX_BUILD_MARKER}`);
  };

  render(): React.Node {
    const {
      log,
      stuckCount,
      pendingPressIns,
      counters,
      identifierReuseCount,
      recentlyCancelledIdentifiers,
    } = this.state;
    const pendingKeys = Object.keys(pendingPressIns);
    // Health check after at least one cancel: every pressIn that happened
    // after a cancel should be matched by a press. If pressInAfterCancel >
    // pressAfterCancel, JS Pressability is dropping the press event even
    // though the cancel made the round trip.
    const postCancelHealthBad =
      counters.touchCancel > 0 &&
      counters.pressInAfterCancel > counters.pressAfterCancel;
    // The v2 native fix should drive identifierReuseCount to 0 — we bumped
    // m_touchId past the cancelled slot in CompositionEventHandler.cpp, so the
    // next allocation should pick a fresh identifier.
    const identifierReuseBad = identifierReuseCount > 0;
    return (
      <View
        style={styles.root}
        onTouchStart={this.onTouchStart}
        onTouchEnd={this.onTouchEnd}
        onTouchCancel={this.onTouchCancel}>
        <View style={styles.header}>
          <Text style={styles.title}>
            Touch ScrollView Diagnostic — issue #16047
          </Text>
          <Text style={styles.buildMarker}>{FIX_BUILD_MARKER}</Text>
          <Text style={styles.subtitle}>
            Touch-scroll any column. Then try to tap a row in any column or in
            the right-side control grid. The "STUCK PRESS" pill should stay
            green and pendingPressIns should be empty between interactions.
          </Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusPill,
                counters.touchCancel > 0
                  ? styles.statusPillGood
                  : styles.statusPillWarn,
              ]}>
              <Text style={styles.statusText}>
                native cancels reaching JS: {counters.touchCancel}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                postCancelHealthBad
                  ? styles.statusPillBad
                  : styles.statusPillGood,
              ]}>
              <Text style={styles.statusText}>
                post-cancel taps: {counters.pressAfterCancel}/
                {counters.pressInAfterCancel} fired press
              </Text>
            </View>
            <View style={[styles.statusPill, styles.statusPillNeutral]}>
              <Text style={styles.statusText}>
                pressIn:{counters.pressIn} pressOut:{counters.pressOut} press:
                {counters.press}
              </Text>
            </View>
          </View>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusPill,
                stuckCount > 0 ? styles.statusPillBad : styles.statusPillGood,
              ]}>
              <Text style={styles.statusText}>
                {stuckCount > 0
                  ? `STUCK PRESS: ${stuckCount} key(s) > ${STUCK_PRESS_THRESHOLD_MS}ms`
                  : 'no stuck presses'}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                pendingKeys.length > 0
                  ? styles.statusPillWarn
                  : styles.statusPillGood,
              ]}>
              <Text style={styles.statusText}>
                pendingPressIns:{' '}
                {pendingKeys.length === 0 ? '(empty)' : pendingKeys.join(', ')}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                identifierReuseBad
                  ? styles.statusPillBad
                  : styles.statusPillGood,
              ]}>
              <Text style={styles.statusText}>
                identifier reuse: {identifierReuseCount}
                {recentlyCancelledIdentifiers.length > 0
                  ? ` (watching ${recentlyCancelledIdentifiers.join(',')})`
                  : ''}
              </Text>
            </View>
            <TouchableHighlight
              style={styles.clearButton}
              onPress={this.clearLog}>
              <Text style={styles.clearButtonText}>Clear log</Text>
            </TouchableHighlight>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.scrollColumns}>
            <View style={styles.columnFrame}>
              <Text style={styles.columnLabel}>ScrollView</Text>
              <ScrollView
                style={styles.scrollColumn}
                keyboardShouldPersistTaps="handled">
                {ROWS.map((item, index) => this.renderRow('sv', item, index))}
              </ScrollView>
            </View>

            <View style={styles.columnFrame}>
              <Text style={styles.columnLabel}>FlatList</Text>
              <FlatList
                style={styles.scrollColumn}
                data={ROWS}
                keyboardShouldPersistTaps="handled"
                keyExtractor={(_, index) => String(index)}
                renderItem={({item, index}) =>
                  this.renderRow('fl', item, index)
                }
              />
            </View>

            <View style={styles.columnFrame}>
              <Text style={styles.columnLabel}>VirtualizedList</Text>
              <VirtualizedList
                style={styles.scrollColumn}
                data={ROWS}
                initialNumToRender={10}
                keyboardShouldPersistTaps="handled"
                getItemCount={() => ROWS.length}
                getItem={(data, index) => data[index]}
                keyExtractor={(_, index) => String(index)}
                renderItem={({item, index}) =>
                  this.renderRow('vl', item, index)
                }
              />
            </View>

            <View style={styles.columnFrame}>
              <Text style={styles.columnLabel}>Control grid (no scroll)</Text>
              <View style={styles.controlGrid}>
                {ROWS.slice(0, 12).map((item, index) =>
                  this.renderRow('ctl', item, index),
                )}
              </View>
            </View>
          </View>

          <View style={styles.logPanel}>
            <Text style={styles.logTitle}>Event log (newest first)</Text>
            <ScrollView style={styles.logScroll}>
              {log.map(entry => (
                <Text key={entry.id} style={styles.logLine}>
                  t+{String(entry.t).padStart(5)}ms {entry.text}
                </Text>
              ))}
            </ScrollView>
          </View>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f6f6f6',
  },
  header: {
    padding: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  buildMarker: {
    fontSize: 11,
    fontFamily: 'Consolas',
    color: '#0a6e0a',
    backgroundColor: '#e6f5e6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginBottom: 6,
    borderRadius: 3,
  },
  subtitle: {
    fontSize: 12,
    color: '#444',
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
  },
  statusPillGood: {
    backgroundColor: '#cdebd0',
  },
  statusPillWarn: {
    backgroundColor: '#fff1c1',
  },
  statusPillBad: {
    backgroundColor: '#ffc7c7',
  },
  statusPillNeutral: {
    backgroundColor: '#e0e0e0',
  },
  statusText: {
    fontSize: 12,
    color: '#222',
  },
  clearButton: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    backgroundColor: '#e0e0e0',
  },
  clearButtonText: {
    fontSize: 12,
    color: '#222',
  },
  body: {
    flex: 1,
    flexDirection: 'row',
  },
  scrollColumns: {
    flex: 3,
    flexDirection: 'row',
    padding: 8,
  },
  columnFrame: {
    flex: 1,
    marginHorizontal: 4,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 4,
    overflow: 'hidden',
  },
  columnLabel: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#eaeaea',
    fontWeight: '600',
    fontSize: 12,
  },
  scrollColumn: {
    flex: 1,
  },
  controlGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 4,
  },
  row: {
    backgroundColor: '#e8eef5',
    paddingVertical: 12,
    paddingHorizontal: 12,
    margin: 4,
    borderRadius: 4,
    minWidth: 90,
    alignItems: 'center',
  },
  rowToggled: {
    backgroundColor: '#4caf50',
  },
  rowPending: {
    borderWidth: 2,
    borderColor: '#ff9900',
  },
  rowText: {
    fontSize: 13,
    color: '#222',
    fontWeight: '500',
  },
  rowTextToggled: {
    color: '#fff',
  },
  logPanel: {
    flex: 2,
    backgroundColor: '#1f1f1f',
    padding: 8,
    borderLeftWidth: 1,
    borderLeftColor: '#444',
  },
  logTitle: {
    color: '#cccccc',
    fontWeight: '600',
    marginBottom: 4,
  },
  logScroll: {
    flex: 1,
  },
  logLine: {
    color: '#d0e8ff',
    fontFamily: 'Consolas',
    fontSize: 11,
    lineHeight: 14,
  },
});

export default ({
  title: 'Playground',
  name: 'playground',
  description: 'Touch ScrollView diagnostic for issue #16047.',
  render: (): React.Node => <TouchScrollDiagnostic />,
}: RNTesterModuleExample);
