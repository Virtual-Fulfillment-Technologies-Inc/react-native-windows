/**
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 *
 * Repro for https://github.com/microsoft/react-native-windows/issues/16047
 *
 * Three side-by-side scrolling regions (ScrollView, FlatList, VirtualizedList)
 * each holding 30 TouchableHighlight rows, plus a control grid of
 * TouchableHighlights outside any scroll region. After a touch-screen scroll
 * the originally-pressed Pressable can be left visually stuck; subsequent taps
 * are misattributed to that stale target.
 *
 * The on-screen event log mirrors the C++ `[RNW Touch]` traces emitted by
 * CompositionEventHandler / CompositionContextHelper so a captured trace and a
 * captured screen recording line up frame-by-frame.
 *
 * The "stuck press" indicator turns red when any row has fired pressIn but
 * has not seen a matching pressOut/release within 5 seconds — the visible
 * sign of the zombie touch in m_activeTouches.
 *
 * @format
 */

import React from 'react';
import {
  AppRegistry,
  FlatList,
  GestureResponderEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableHighlight,
  View,
  VirtualizedList,
} from 'react-native';

const ROWS = Array.from({length: 30}, (_, i) => `Item ${i + 1}`);
const MAX_LOG_LINES = 60;
const STUCK_PRESS_THRESHOLD_MS = 5000;

type LogEntry = {
  id: number;
  t: number;
  text: string;
};

type State = {
  toggled: Record<string, boolean>;
  log: LogEntry[];
  pendingPressIns: Record<string, number>; // key -> timestamp(ms) of pressIn
  stuckCount: number;
  startedAt: number;
};

type ColumnKind = 'sv' | 'fl' | 'vl' | 'ctl';

function rowKey(column: ColumnKind, index: number): string {
  return `${column}-${index}`;
}

class TouchScrollDiagnostic extends React.Component<{}, State> {
  private nextLogId = 1;
  private stuckTimer: ReturnType<typeof setInterval> | undefined;

  state: State = {
    toggled: {},
    log: [],
    pendingPressIns: {},
    stuckCount: 0,
    startedAt: Date.now(),
  };

  componentDidMount(): void {
    this.stuckTimer = setInterval(this.evaluateStuck, 500);
    this.appendLog('[mounted] stuck-press detector running every 500ms');
  }

  componentWillUnmount(): void {
    if (this.stuckTimer !== undefined) {
      clearInterval(this.stuckTimer);
    }
  }

  private appendLog = (text: string): void => {
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

  private evaluateStuck = (): void => {
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

  private formatTouches = (e: GestureResponderEvent): string => {
    const t = e.nativeEvent.touches.map(
      x => `id=${x.identifier} target=${x.target} pos=(${x.pageX.toFixed(0)},${x.pageY.toFixed(0)})`,
    );
    return t.length === 0 ? '(none)' : t.join(' | ');
  };

  private onTouchStart = (e: GestureResponderEvent): void => {
    this.appendLog(`[RNW Touch JS] touchstart ${this.formatTouches(e)}`);
  };

  private onTouchEnd = (e: GestureResponderEvent): void => {
    this.appendLog(`[RNW Touch JS] touchend ${this.formatTouches(e)}`);
  };

  private onTouchCancel = (e: GestureResponderEvent): void => {
    this.appendLog(`[RNW Touch JS] touchcancel ${this.formatTouches(e)}`);
  };

  private handlePressIn = (column: ColumnKind, index: number): void => {
    const key = rowKey(column, index);
    this.setState(prev => ({
      pendingPressIns: {...prev.pendingPressIns, [key]: Date.now()},
    }));
    this.appendLog(`[RNW Touch JS] pressIn ${key}`);
  };

  private handlePressOut = (column: ColumnKind, index: number): void => {
    const key = rowKey(column, index);
    this.setState(prev => {
      if (!(key in prev.pendingPressIns)) {
        return null;
      }
      const next = {...prev.pendingPressIns};
      delete next[key];
      return {pendingPressIns: next};
    });
    this.appendLog(`[RNW Touch JS] pressOut ${key}`);
  };

  private handlePress = (column: ColumnKind, index: number): void => {
    const key = rowKey(column, index);
    this.setState(prev => ({
      toggled: {...prev.toggled, [key]: !prev.toggled[key]},
    }));
    this.appendLog(`[RNW Touch JS] press ${key}`);
  };

  private renderRow = (column: ColumnKind, item: string, index: number) => {
    const key = rowKey(column, index);
    const isToggled = !!this.state.toggled[key];
    const hasPendingPressIn = key in this.state.pendingPressIns;
    return (
      <TouchableHighlight
        key={key}
        style={[
          styles.row,
          isToggled && styles.rowToggled,
          hasPendingPressIn && styles.rowPending,
        ]}
        onPressIn={() => this.handlePressIn(column, index)}
        onPressOut={() => this.handlePressOut(column, index)}
        onPress={() => this.handlePress(column, index)}>
        <Text style={[styles.rowText, isToggled && styles.rowTextToggled]}>
          {item}
        </Text>
      </TouchableHighlight>
    );
  };

  private clearLog = (): void => {
    this.setState({log: [], pendingPressIns: {}, stuckCount: 0, startedAt: Date.now()});
  };

  render(): React.ReactElement {
    const {log, stuckCount, pendingPressIns} = this.state;
    const pendingKeys = Object.keys(pendingPressIns);
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
          <Text style={styles.subtitle}>
            Touch-scroll any column. Then try to tap a row in any column or in
            the right-side control grid. The "currently pressed" indicator
            should be green and pendingPressIns should be empty between
            interactions.
          </Text>
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
                pendingKeys.length > 0 ? styles.statusPillWarn : styles.statusPillGood,
              ]}>
              <Text style={styles.statusText}>
                pendingPressIns: {pendingKeys.length === 0 ? '(empty)' : pendingKeys.join(', ')}
              </Text>
            </View>
            <TouchableHighlight style={styles.clearButton} onPress={this.clearLog}>
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
                renderItem={({item, index}) => this.renderRow('fl', item, index)}
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
                getItem={(data, index) => (data as string[])[index]}
                keyExtractor={(_: string, index: number) => String(index)}
                renderItem={({item, index}: {item: string; index: number}) =>
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
                  t+{String(entry.t).padStart(5)}ms  {entry.text}
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

AppRegistry.registerComponent('Bootstrap', () => TouchScrollDiagnostic);
