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
 * Reproduces the native `facebook::yoga::Node` crash that occurs when large
 * subtrees mount/unmount rapidly inside a ScrollView (modal step transitions:
 * idle -> processing -> error). Mirrors the scenario worked around in
 * Vendora PR #1719 (avoiding Modal.Body / ScrollView for step content).
 *
 * HOW TO USE
 * 1. Build + run Debug under the Visual Studio debugger:
 *      cd packages/e2e-test-app-fabric && yarn windows
 *    (attach VS so the native Yoga stack is symbolicated when it faults).
 * 2. Open the "Playground" example.
 * 3. Tap "Open repro modal", then "Start auto-cycle".
 * 4. Watch the iteration counter; note the count if/when it crashes.
 *
 * A/B CONTROLS
 * - "Use ScrollView" off swaps the ScrollView for a plain View (the PR #1719
 *   workaround). If the crash stops, the ScrollView is confirmed as the trigger.
 * - "Concurrency stressors" on adds two extra churn sources designed to widen
 *   the layout-race window: an off-cadence content-size tick (adds/removes rows)
 *   and a modal-card resize loop (forces the modal ContentIsland to re-measure
 *   on its own schedule, potentially concurrent with JS-thread commits).
 */

import type {RNTesterModuleExample} from '../../types/RNTesterTypes';

import RNTesterText from '../../components/RNTesterText';
import * as React from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, View} from 'react-native';

const STEPS: $ReadOnlyArray<string> = [
  'idle',
  'processing',
  'error',
  'success',
];

const STEP_INTERVAL_MS = 150; // how fast step content remounts
const STRESS_TICK_MS = 33; // off-cadence content-size churn
const STRESS_RESIZE_MS = 80; // off-cadence modal re-measure
const BASE_NODES = 250; // size of each remounted subtree

function swatchColor(step: string): {backgroundColor: string} {
  switch (step) {
    case 'processing':
      return {backgroundColor: '#f1c40f'};
    case 'error':
      return {backgroundColor: '#e74c3c'};
    case 'success':
      return {backgroundColor: '#2ecc71'};
    default:
      return {backgroundColor: '#3498db'};
  }
}

// Large subtree so each remount is expensive (widens the layout-race window).
function BigTree({step, nodes}: {step: string, nodes: number}): React.Node {
  return (
    <View>
      {Array.from({length: nodes}).map((_, i) => (
        <View key={`${step}-${i}`} style={styles.row}>
          <View style={[styles.swatch, swatchColor(step)]} />
          <RNTesterText>{`${step} row ${i}`}</RNTesterText>
        </View>
      ))}
    </View>
  );
}

function Playground(): React.Node {
  const [open, setOpen] = React.useState(false);
  const [stepIndex, setStepIndex] = React.useState(0);
  const [auto, setAuto] = React.useState(false);
  const [useScrollView, setUseScrollView] = React.useState(true);
  const [stress, setStress] = React.useState(false);
  const [iterations, setIterations] = React.useState(0);

  // Stressor state.
  const [extraRows, setExtraRows] = React.useState(0);
  const [wide, setWide] = React.useState(false);

  // Auto-cycle steps: rapidly mount/unmount large trees inside the ScrollView.
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

  // Stressor 1: off-cadence content-size churn (adds/removes rows) to force
  // ScrollView content-size recalculation independently of step changes.
  React.useEffect(() => {
    if (!stress || !auto || !open) {
      return;
    }
    const id = setInterval(() => {
      setExtraRows(r => (r + 7) % 40);
    }, STRESS_TICK_MS);
    return () => clearInterval(id);
  }, [stress, auto, open]);

  // Stressor 2: off-cadence modal-card resize to force the modal ContentIsland
  // to re-measure/arrange on its own schedule (suspected off-JS-thread layout).
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
  const Body = useScrollView ? ScrollView : View;
  const nodes = BASE_NODES + (stress ? extraRows : 0);

  return (
    <View style={styles.container}>
      <RNTesterText style={styles.heading}>
        Yoga ScrollView remount crash repro (POS-V2-A0)
      </RNTesterText>
      <RNTesterText>
        {`useScrollView: ${String(useScrollView)}   stressors: ${String(
          stress,
        )}   iterations: ${iterations}`}
      </RNTesterText>

      <Pressable
        style={styles.btn}
        onPress={() => setUseScrollView(v => !v)}>
        <RNTesterText>Toggle ScrollView vs View (A/B PR #1719 workaround)</RNTesterText>
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
        <RNTesterText>Open repro modal</RNTesterText>
      </Pressable>

      <Modal
        visible={open}
        transparent
        onRequestClose={() => {
          setAuto(false);
          setOpen(false);
        }}>
        <View style={styles.backdrop}>
          <View style={[styles.card, wide ? styles.cardWide : styles.cardNarrow]}>
            <RNTesterText style={styles.heading}>{`step: ${step}  (nodes: ${nodes})`}</RNTesterText>
            <Body style={styles.body}>
              <BigTree step={step} nodes={nodes} />
            </Body>
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
      </Modal>
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
  backdrop: {
    flex: 1,
    backgroundColor: '#00000088',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 12,
    maxHeight: '80%',
  },
  cardNarrow: {
    width: '70%',
  },
  cardWide: {
    width: '92%',
  },
  body: {
    maxHeight: 360,
    marginVertical: 8,
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
  },
});

export default ({
  title: 'Playground',
  name: 'playground',
  description: 'Test out new features and ideas.',
  render: (): React.Node => <Playground />,
}: RNTesterModuleExample);
