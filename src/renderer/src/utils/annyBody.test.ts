import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createRig, fillTorsoAnchors, fitAnnyToJoints, type HalpeName, type AnnyRig } from './annyBody';

// Synthetic T-pose rigs carrying Anny's bone labels -- no Anny model data needed. Only the labels the
// fit drives have to exist; the positions are just a plausible body.
interface Spec { labels: string[]; parents: number[]; rest: Array<[number, number, number]> }

// pelvis, hips, three spine bones, knees, ankles, toes, neck, collars, head, shoulders, elbows, wrists.
const SIMPLE: Spec = {
  labels: [
    'root', 'upperleg01.L', 'upperleg01.R', 'spine04', 'lowerleg01.L', 'lowerleg01.R', 'spine02', 'foot.L', 'foot.R',
    'spine01', 'toe1-1.L', 'toe1-1.R', 'neck01', 'clavicle.L', 'clavicle.R', 'head', 'upperarm01.L', 'upperarm01.R',
    'lowerarm01.L', 'lowerarm01.R', 'wrist.L', 'wrist.R',
  ],
  parents: [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19],
  rest: [
    [0, 0, 0], [0.1, -0.1, 0], [-0.1, -0.1, 0], [0, 0.1, 0], [0.1, -0.5, 0], [-0.1, -0.5, 0],
    [0, 0.2, 0], [0.1, -0.9, 0], [-0.1, -0.9, 0], [0, 0.35, 0], [0.1, -0.95, 0.12], [-0.1, -0.95, 0.12],
    [0, 0.45, 0], [0.08, 0.4, 0], [-0.08, 0.4, 0], [0, 0.6, 0], [0.18, 0.42, 0], [-0.18, 0.42, 0],
    [0.45, 0.42, 0], [-0.45, 0.42, 0], [0.7, 0.42, 0], [-0.7, 0.42, 0],
  ],
};

// SIMPLE with MakeHuman's twist bone spliced between the left thigh and shin, sitting slightly off the
// straight line like the real one does.
function withTwist(spec: Spec): Spec {
  const at = spec.labels.indexOf('upperleg01.L') + 1;
  const shift = (i: number) => (i >= at ? i + 1 : i);
  const hip = spec.rest[spec.labels.indexOf('upperleg01.L')];
  const knee = spec.rest[spec.labels.indexOf('lowerleg01.L')];

  const labels = [...spec.labels];
  labels.splice(at, 0, 'upperleg02.L');
  const rest = [...spec.rest];
  rest.splice(at, 0, [(hip[0] + knee[0]) / 2 + 0.02, (hip[1] + knee[1]) / 2, 0.02]);
  const parents = spec.parents.map(shift);
  parents.splice(at, 0, at - 1);
  parents[labels.indexOf('lowerleg01.L')] = at; // the shin now hangs off the twist bone
  return { labels, parents, rest };
}

// Toes/heels at rest, each carried by its ankle bone. Feet point straight at +Z.
const LANDMARKS: Array<[HalpeName, [number, number, number], string]> = [
  ['l_heel', [0.1, -0.97, -0.05], 'foot.L'], ['l_big_toe', [0.07, -0.98, 0.15], 'foot.L'], ['l_small_toe', [0.13, -0.98, 0.15], 'foot.L'],
  ['r_heel', [-0.1, -0.97, -0.05], 'foot.R'], ['r_big_toe', [-0.07, -0.98, 0.15], 'foot.R'], ['r_small_toe', [-0.13, -0.98, 0.15], 'foot.R'],
];
const HALPE_TO_LABEL: Array<[HalpeName, string]> = [
  ['pelvis', 'root'], ['l_hip', 'upperleg01.L'], ['r_hip', 'upperleg01.R'], ['l_knee', 'lowerleg01.L'], ['r_knee', 'lowerleg01.R'],
  ['l_ankle', 'foot.L'], ['r_ankle', 'foot.R'], ['neck', 'neck01'], ['head', 'head'], ['l_shoulder', 'upperarm01.L'],
  ['r_shoulder', 'upperarm01.R'], ['l_elbow', 'lowerarm01.L'], ['r_elbow', 'lowerarm01.R'], ['l_wrist', 'wrist.L'], ['r_wrist', 'wrist.R'],
];
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

function makeRig(spec: Spec = SIMPLE) {
  return createRig(
    spec.rest.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    spec.parents,
    spec.labels,
    new Map(LANDMARKS.map(([name, [x, y, z]]) => [name, new THREE.Vector3(x, y, z)])),
  );
}

function bone(rig: AnnyRig, label: string) {
  return rig.bones[rig.labels.indexOf(label)];
}

// World positions of every Halpe point the rig carries, as IRIS would report them.
function readJoints(rig: AnnyRig) {
  rig.group.updateMatrixWorld(true);
  const joints = new Map(HALPE_TO_LABEL.map(([name, label]) => [name, bone(rig, label).getWorldPosition(new THREE.Vector3())]));
  for (const [name, , ankle] of LANDMARKS) {
    const ankleIndex = rig.labels.indexOf(ankle);
    joints.set(name, rig.bones[ankleIndex].localToWorld(rig.landmarks.get(name)!.clone().sub(rig.rest[ankleIndex])));
  }
  return joints;
}

// Poses a fresh rig with known bone transforms and reads it back as observed joints.
function observe(pose: (rig: AnnyRig) => void, spec: Spec = SIMPLE) {
  const truth = makeRig(spec);
  pose(truth);
  return { truth, joints: readJoints(truth) };
}

function worldRotation(rig: AnnyRig, label: string) {
  return bone(rig, label).getWorldQuaternion(new THREE.Quaternion());
}

describe('createRig', () => {
  it('refuses a rig missing a bone the fit drives, naming it', () => {
    const spec: Spec = { ...SIMPLE, labels: SIMPLE.labels.map((l) => (l === 'lowerleg01.R' ? 'shin.R' : l)) };
    expect(() => makeRig(spec)).toThrow(/lowerleg01\.R/);
  });

  it('refuses bones listed before their parents', () => {
    const spec: Spec = { ...SIMPLE, parents: SIMPLE.parents.map((p, i) => (i === 4 ? 7 : p)) };
    expect(() => makeRig(spec)).toThrow(/parent-first/);
  });
});

describe('fitAnnyToJoints', () => {
  it('leaves every bone at identity when the joints are the rest pose', () => {
    const rig = makeRig();
    fitAnnyToJoints(rig, observe(() => {}).joints);

    for (const b of rig.bones) {
      expect(b.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    }
    expect(rig.group.scale.x).toBeCloseTo(1, 6);
  });

  it('recovers limb roll from knee/elbow bends and foot direction, and feet from heel + toes', () => {
    const { truth, joints } = observe((rig) => {
      bone(rig, 'root').quaternion.setFromEuler(new THREE.Euler(0.3, 1.1, -0.2));
      bone(rig, 'root').position.add(new THREE.Vector3(0.5, 0.9, -0.3));
      bone(rig, 'upperleg01.L').quaternion.setFromEuler(new THREE.Euler(-0.6, 0.4, 0.2)); // left thigh: flexed, rolled, abducted
      bone(rig, 'lowerleg01.L').quaternion.setFromAxisAngle(X, 1.0); // left knee bent
      bone(rig, 'foot.L').quaternion.setFromAxisAngle(X, -0.3); // left ankle pointed
      bone(rig, 'upperleg01.R').quaternion.setFromAxisAngle(Y, 0.5); // right leg straight, rolled -- only the foot shows it
      bone(rig, 'upperarm01.L').quaternion.setFromEuler(new THREE.Euler(0.2, -0.5, 0.4)); // left upper arm
      bone(rig, 'lowerarm01.L').quaternion.setFromAxisAngle(Y, -1.2); // left elbow bent forwards
    });

    const rig = makeRig();
    fitAnnyToJoints(rig, joints);
    const fitted = readJoints(rig);

    for (const [name, position] of joints) {
      expect(fitted.get(name)!.distanceTo(position), name).toBeLessThan(1e-4);
    }
    for (const label of ['upperleg01.L', 'upperleg01.R', 'lowerleg01.L', 'lowerleg01.R', 'foot.L', 'foot.R', 'upperarm01.L', 'lowerarm01.L']) {
      expect(worldRotation(rig, label).angleTo(worldRotation(truth, label)), label).toBeLessThan(1e-4);
    }
  });

  it('rolls the shin to follow the foot when it turns relative to the thigh', () => {
    const { truth, joints } = observe((rig) => {
      bone(rig, 'lowerleg01.L').quaternion.setFromAxisAngle(X, 1.0).multiply(new THREE.Quaternion().setFromAxisAngle(Y, 0.4));
    });

    const rig = makeRig();
    fitAnnyToJoints(rig, joints);
    rig.group.updateMatrixWorld(true);

    for (const label of ['lowerleg01.L', 'foot.L']) {
      expect(worldRotation(rig, label).angleTo(worldRotation(truth, label)), label).toBeLessThan(1e-4);
    }
  });

  it('ignores a few degrees of elbow bend when rolling the upper arm', () => {
    const { joints } = observe((rig) => bone(rig, 'lowerarm01.L').quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.08));

    const rig = makeRig();
    fitAnnyToJoints(rig, joints);

    expect(bone(rig, 'upperarm01.L').quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  });

  it('stretches limbs to reach knees, ankles, elbows and wrists despite wider hip keypoints', () => {
    const { joints } = observe((rig) => {
      bone(rig, 'lowerleg01.L').quaternion.setFromAxisAngle(X, 0.8);
      bone(rig, 'foot.L').position.multiplyScalar(1.25); // longer left shin
      bone(rig, 'wrist.L').position.multiplyScalar(0.9); // shorter left forearm
    });
    // COCO-style hip keypoints sit wider and lower than the rig's hip joints.
    joints.get('l_hip')!.add(new THREE.Vector3(0.05, -0.02, 0));
    joints.get('r_hip')!.add(new THREE.Vector3(-0.05, -0.02, 0));

    const rig = makeRig();
    fitAnnyToJoints(rig, joints);
    const fitted = readJoints(rig);

    for (const name of ['l_knee', 'r_knee', 'l_ankle', 'r_ankle', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist'] as const) {
      expect(fitted.get(name)!.distanceTo(joints.get(name)!), name).toBeLessThan(1e-4);
    }
  });

  // Anny's real thigh is upperleg01 -> upperleg02 -> lowerleg01. The knee must still land exactly when
  // the length to reach it is spread across both bones, not just the one directly below the hip.
  it('stretches through a twist bone so the knee and ankle still land on the tracked joints', () => {
    const spec = withTwist(SIMPLE);
    const { joints } = observe((rig) => {
      bone(rig, 'upperleg02.L').position.multiplyScalar(1.3); // longer thigh, via the twist link
      bone(rig, 'lowerleg01.L').quaternion.setFromAxisAngle(X, 0.8);
      bone(rig, 'foot.L').position.multiplyScalar(1.25); // longer shin
    }, spec);

    const rig = makeRig(spec);
    fitAnnyToJoints(rig, joints);
    const fitted = readJoints(rig);

    // The stretched joints land exactly. The toe won't: feet keep their rest length under the body's one
    // uniform scale, and this truth lengthened the leg without lengthening the foot.
    for (const name of ['l_knee', 'l_ankle'] as const) {
      expect(fitted.get(name)!.distanceTo(joints.get(name)!), name).toBeLessThan(1e-4);
    }
    expect(bone(rig, 'upperleg02.L').quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6); // rides along, never posed
  });

  // Limb lengths freeze after a burst of startup frames, so however they're pooled decides the
  // mesh's proportions for the whole session. IRIS loses a leg to occlusion now and again and
  // reports a badly placed ankle; averaging lets a handful of those stretch the shin permanently,
  // which is what puts knees and ankles off the tracked positions in the live view.
  it('ignores mistracked startup frames when freezing limb lengths', () => {
    const pose = (rig: AnnyRig) => bone(rig, 'lowerleg01.L').quaternion.setFromAxisAngle(X, 0.8);
    const good = observe(pose).joints;
    // 3 of 30 startup frames put the ankle way off -- a dropped/occluded leg, not a longer shin.
    const bad = observe(pose).joints;
    bad.set('l_ankle', bad.get('l_ankle')!.clone().add(new THREE.Vector3(0, -0.45, 0)));

    const rig = makeRig();
    for (let frame = 0; frame < 30; frame += 1) fitAnnyToJoints(rig, frame % 10 === 0 ? bad : good);
    fitAnnyToJoints(rig, good);

    const fitted = readJoints(rig);
    for (const name of ['l_knee', 'l_ankle'] as const) {
      expect(fitted.get(name)!.distanceTo(good.get(name)!), name).toBeLessThan(0.01);
    }
  });

  it('does nothing without a torso to anchor to', () => {
    const rig = makeRig();
    const { joints } = observe((truth) => bone(truth, 'root').quaternion.set(0, 1, 0, 0));
    joints.delete('neck');
    fitAnnyToJoints(rig, joints);

    expect(bone(rig, 'root').quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
  });
});

describe('fillTorsoAnchors', () => {
  // COCO WholeBody-133 reports hips, shoulders and feet but no pelvis, neck or head.
  it('lets a layout without pelvis, neck or head still land the limbs on the tracked joints', () => {
    const { joints } = observe((rig) => {
      bone(rig, 'root').quaternion.setFromEuler(new THREE.Euler(0.2, 0.7, -0.1));
      bone(rig, 'lowerleg01.L').quaternion.setFromAxisAngle(X, 0.8);
      bone(rig, 'lowerarm01.L').quaternion.setFromAxisAngle(Y, -1.0);
    });
    for (const name of ['pelvis', 'neck', 'head'] as const) joints.delete(name);
    fillTorsoAnchors(joints);

    const rig = makeRig();
    fitAnnyToJoints(rig, joints);
    const fitted = readJoints(rig);

    for (const name of ['l_knee', 'r_knee', 'l_ankle', 'r_ankle', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist'] as const) {
      expect(fitted.get(name)!.distanceTo(joints.get(name)!), name).toBeLessThan(1e-4);
    }
  });

  it('keeps reported anchors and adds nothing without both sides', () => {
    const pelvis = new THREE.Vector3(1, 2, 3);
    const joints = new Map<HalpeName, THREE.Vector3>([
      ['pelvis', pelvis], ['l_hip', new THREE.Vector3(1, 0, 0)], ['r_hip', new THREE.Vector3(-1, 0, 0)],
      ['l_shoulder', new THREE.Vector3(1, 1, 0)],
    ]);
    fillTorsoAnchors(joints);

    expect(joints.get('pelvis')).toBe(pelvis);
    expect(joints.has('neck')).toBe(false);
  });
});
