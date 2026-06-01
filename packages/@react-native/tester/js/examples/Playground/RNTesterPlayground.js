/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow strict-local
 * @format
 */

/**
 * Yoga layout crash repro (Sentry POS-V2-A0).
 *
 * Faithful replica of the Vendora POS PaymentProcessingModal scenario that
 * crashes in `facebook::yoga::Node` on react-native-windows. The app does NOT
 * use the native <Modal>; it portal-renders content into an absolutely
 * positioned, height-constrained overlay. The modal body is a ScrollView
 * (`Modal.Body`) that imperatively calls
 * `setNativeProps({scrollEnabled, ...})` from inside `onContentSizeChange` /
 * `onLayout` whenever the content height crosses the container height.
 *
 * As the payment step cycles idle -> processing -> error, the body content
 * alternates between overflowing (tall) and fitting (short), so `scrollEnabled`
 * flips imperatively on nearly every transition. That imperative native-prop
 * mutation, racing with the commit that remounts the ScrollView's children, is
 * the suspected trigger. (PR #1719 worked around it by swapping the ScrollView
 * body for a plain View.)
 *
 * HOW TO USE
 * 1. Build + run Debug under the Visual Studio debugger:
 *      cd packages/e2e-test-app-fabric && yarn windows
 *    (attach VS so the native Yoga stack is symbolicated when it faults; enable
 *     Debug > Windows > Exception Settings > Win32 Exceptions > Access violation)
 * 2. Open the "Playground" example.
 * 3. Tap "Open repro overlay", then "Start auto-cycle". Watch the iteration
 *    counter; note the count if/when it crashes.
 *
 * A/B CONTROLS
 * - "Use ScrollView body" off  -> plain View body (PR #1719 workaround).
 * - "setNativeProps scroll toggle" off -> stops the imperative scrollEnabled
 *   flips; if this alone stops the crash, the imperative path is the trigger.
 * - "Concurrency stressors" on -> off-cadence content-size churn + overlay
 *   resize loop to widen the layout-race window.
 */

import type {RNTesterModuleExample} from '../../types/RNTesterTypes';

import RNTesterText from '../../components/RNTesterText';
import * as React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

const STEPS: $ReadOnlyArray<string> = ['idle', 'processing', 'error'];

const STEP_INTERVAL_MS = 150; // how fast the payment step (and body) remounts
const STRESS_TICK_MS = 33; // off-cadence content-size churn
const STRESS_RESIZE_MS = 80; // off-cadence overlay re-measure

// idle overflows the body (forces scrollEnabled=true), processing is a tiny
// spinner (scrollEnabled=false), error is medium. Alternating across these
// makes the imperative setNativeProps toggle fire on nearly every transition.
const IDLE_ROWS = 40;
const ERROR_ROWS = 8;

type BodyProps = {
  children: React.Node,
  useScrollView: boolean,
  useSetNativeProps: boolean,
};

// Faithful replica of Vendora's Modal.Body: a ScrollView that imperatively
// flips scrollEnabled via setNativeProps based on measured content vs container.
function ReproBody({
  children,
  useScrollView,
  useSetNativeProps,
}: BodyProps): React.Node {
  const svRef = React.useRef<?React.ElementRef<typeof ScrollView>>(null);
  const containerH = React.useRef(0);
  const contentH = React.useRef(0);
  const lastEnabled = React.useRef<?boolean>(null);

  const updateScroll = React.useCallback(() => {
    if (!useSetNativeProps) {
      return;
    }
    const enabled = contentH.current > containerH.current + 1; // epsilon
    if (lastEnabled.current === enabled) {
      return;
    }
    lastEnabled.current = enabled;
    svRef.current?.setNativeProps({
      scrollEnabled: enabled,
      showsVerticalScrollIndicator: enabled,
      bounces: enabled,
      overScrollMode: enabled ? 'always' : 'never',
    });
  }, [useSetNativeProps]);

  const handleLayout = React.useCallback(
    e => {
      const h = e.nativeEvent.layout.height;
      if (h !== containerH.current) {
        containerH.current = h;
        updateScroll();
      }
    },
    [updateScroll],
  );

  const handleContentSizeChange = React.useCallback(
    (w: number, h: number) => {
      if (h !== contentH.current) {
        contentH.current = h;
        updateScroll();
      }
    },
    [updateScroll],
  );

  if (!useScrollView) {
    return (
      <View style={styles.body} onLayout={handleLayout}>
        {children}
      </View>
    );
  }

  return (
    <ScrollView
      ref={svRef}
      style={styles.body}
      contentContainerStyle={styles.bodyContent}
      onLayout={handleLayout}
      onContentSizeChange={handleContentSizeChange}
      scrollEnabled={false}
      showsVerticalScrollIndicator={false}
      bounces={false}
      overScrollMode="never"
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

function Rows({prefix, count}: {prefix: string, count: number}): React.Node {
  return (
    <View>
      {Array.from({length: count}).map((_, i) => (
        <View key={`${prefix}-${i}`} style={styles.row}>
          <View style={styles.swatch} />
          <RNTesterText>{`${prefix} row ${i}`}</RNTesterText>
        </View>
      ))}
    </View>
  );
}

function StepContent({
  step,
  extraRows,
}: {
  step: string,
  extraRows: number,
}): React.Node {
  switch (step) {
    case 'processing':
      return (
        <View style={styles.center}>
          <ActivityIndicator />
          <RNTesterText>Communicating with payment processor...</RNTesterText>
        </View>
      );
    case 'error':
      return <Rows prefix="error" count={ERROR_ROWS + extraRows} />;
    case 'idle':
    default:
      return <Rows prefix="idle" count={IDLE_ROWS + extraRows} />;
  }
}

function Playground(): React.Node {
  const [open, setOpen] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [auto, setAuto] = React.useState(false);
  const [useScrollView, setUseScrollView] = React.useState(true);
  const [useSetNativeProps, setUseSetNativeProps] = React.useState(true);
  const [stress, setStress] = React.useState(false);
  const [iterations, setIterations] = React.useState(0);

  const [extraRows, setExtraRows] = React.useState(0);
  const [wide, setWide] = React.useState(false);

  // Cycle the payment step: idle -> processing -> error, remounting the body.
  React.useEffect(() => {
    if (!auto || !open) {
      return;
    }
    const id = setInterval(() => {
      setStepIndex(s => (s + 1) % STEPS.length);
      setIterations(n => n + 1);
    }, STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [auto, open]);

  // Stressor 1: off-cadence content-size churn (forces extra content-size
  // changes -> extra setNativeProps toggles independent of step changes).
  React.useEffect(() => {
    if (!stress || !auto || !open) {
      return;
    }
    const id = setInterval(() => {
      setExtraRows(r => (r + 5) % 30);
    }, STRESS_TICK_MS);
    return () => clearInterval(id);
  }, [stress, auto, open]);

  // Stressor 2: off-cadence overlay resize -> forces the constrained container
  // to re-measure on its own schedule, potentially concurrent with commits.
  React.useEffect(() => {
    if (!stress || !auto || !open) {
      return;
    }
    const id = setInterval(() => {
      setWide(w => !w);
    }, STRESS_RESIZE_MS);
    return () => clearInterval(id);
  }, [stress, auto, open]);

  const step = STEPS[stepIndex];

  return (
    <View style={styles.container}>
      <RNTesterText style={styles.heading}>
        Yoga ScrollView crash repro (POS-V2-A0 / PaymentProcessingModal)
      </RNTesterText>
      <RNTesterText>
        {`scrollView:${String(useScrollView)}  setNativeProps:${String(
          useSetNativeProps,
        )}  stress:${String(stress)}  iters:${iterations}`}
      </RNTesterText>

      <Pressable style={styles.btn} onPress={() => setUseScrollView(v => !v)}>
        <RNTesterText>Toggle ScrollView body vs View (PR #1719 A/B)</RNTesterText>
      </Pressable>
      <Pressable
        style={styles.btn}
        onPress={() => setUseSetNativeProps(v => !v)}>
        <RNTesterText>Toggle setNativeProps scroll toggle</RNTesterText>
      </Pressable>
      <Pressable style={styles.btn} onPress={() => setStress(v => !v)}>
        <RNTesterText>
          {stress ? 'Disable concurrency stressors' : 'Enable concurrency stressors'}
        </RNTesterText>
      </Pressable>
      <Pressable
        style={styles.btn}
        onPress={() => {
          setIterations(0);
          setOpen(true);
        }}>
        <RNTesterText>Open repro overlay</RNTesterText>
      </Pressable>

      {/* Portal-style overlay (absolute fill, height-constrained dialog) —
          mirrors the rn-primitives Portal + max-h-[95%] dialog in Vendora. */}
      {open ? (
        <View style={styles.overlay} pointerEvents="box-none">
          <View style={[styles.dialog, wide ? styles.dialogWide : styles.dialogNarrow]}>
            <RNTesterText style={styles.heading}>{`step: ${step}`}</RNTesterText>
            <ReproBody
              useScrollView={useScrollView}
              useSetNativeProps={useSetNativeProps}>
              <StepContent step={step} extraRows={stress ? extraRows : 0} />
            </ReproBody>
            <View style={styles.footerRow}>
              <Pressable style={styles.btn} onPress={() => setAuto(a => !a)}>
                <RNTesterText>{auto ? 'Stop auto-cycle' : 'Start auto-cycle'}</RNTesterText>
              </Pressable>
              <Pressable
                style={styles.btn}
                onPress={() => {
                  setStepIndex(s => (s + 1) % STEPS.length);
                  setIterations(n => n + 1);
                }}>
                <RNTesterText>Step once</RNTesterText>
              </Pressable>
              <Pressable
                style={styles.btn}
                onPress={() => {
                  setAuto(false);
                  setOpen(false);
                }}>
                <RNTesterText>Close</RNTesterText>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 10,
    gap: 8,
  },
  heading: {
    fontWeight: 'bold',
  },
  btn: {
    padding: 10,
    backgroundColor: '#0f3460',
    borderRadius: 6,
    marginVertical: 4,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#00000088',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 12,
    // Constrain height so the tall "idle" content overflows the body and the
    // body's setNativeProps scroll toggle actually fires.
    maxHeight: '70%',
  },
  dialogNarrow: {
    width: '70%',
  },
  dialogWide: {
    width: '92%',
  },
  body: {
    marginVertical: 8,
  },
  bodyContent: {
    gap: 8,
  },
  center: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 24,
  },
  footerRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  swatch: {
    width: 16,
    height: 16,
    borderRadius: 3,
    backgroundColor: '#3498db',
  },
});

export default ({
  title: 'Playground',
  name: 'playground',
  description: 'Test out new features and ideas.',
  render: (): React.Node => <Playground />,
}: RNTesterModuleExample);
