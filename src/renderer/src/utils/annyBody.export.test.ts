import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fitAnnyToJoints, loadAnnyBody, type HalpeName, type AnnyBody, type AnnyRig } from './annyBody';

// Runs the app's own loader and fit against the real scripts/export_anny_mesh.py output. The synthetic
// rigs in annyBody.test.ts prove the maths; this proves the artifact -- that Anny's labels, hierarchy,
// axis convention and regressed landmarks all line up with what the fit expects. Skipped when the
// export hasn't been generated.
const ANNY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../public/anny');
const exported = fs.existsSync(path.join(ANNY_DIR, 'anny_neutral.json'));

const HALPE_TO_LABEL: Array<[HalpeName, string]> = [
  ['pelvis', 'root'], ['l_hip', 'upperleg01.L'], ['r_hip', 'upperleg01.R'], ['l_knee', 'lowerleg01.L'], ['r_knee', 'lowerleg01.R'],
  ['l_ankle', 'foot.L'], ['r_ankle', 'foot.R'], ['neck', 'neck01'], ['head', 'head'], ['l_shoulder', 'upperarm01.L'],
  ['r_shoulder', 'upperarm01.R'], ['l_elbow', 'lowerarm01.L'], ['r_elbow', 'lowerarm01.R'], ['l_wrist', 'wrist.L'], ['r_wrist', 'wrist.R'],
];
const FOOT_LANDMARKS: Array<[HalpeName, string]> = [
  ['l_heel', 'foot.L'], ['l_big_toe', 'foot.L'], ['l_small_toe', 'foot.L'],
  ['r_heel', 'foot.R'], ['r_big_toe', 'foot.R'], ['r_small_toe', 'foot.R'],
];

function bone(rig: AnnyRig, label: string) {
  return rig.bones[rig.labels.indexOf(label)];
}

// World positions of every Halpe point the rig carries, as IRIS would report them.
function readJoints(rig: AnnyRig) {
  rig.group.updateMatrixWorld(true);
  const joints = new Map(HALPE_TO_LABEL.map(([name, label]) => [name, bone(rig, label).getWorldPosition(new THREE.Vector3())]));
  for (const [name, ankle] of FOOT_LANDMARKS) {
    const ankleIndex = rig.labels.indexOf(ankle);
    joints.set(name, rig.bones[ankleIndex].localToWorld(rig.landmarks.get(name)!.clone().sub(rig.rest[ankleIndex])));
  }
  return joints;
}

describe.skipIf(!exported)('the real Anny export', () => {
  beforeAll(() => {
    // loadAnnyBody() fetches relative URLs; serve them straight from public/anny.
    vi.stubGlobal('fetch', async (url: string) => {
      const file = path.join(ANNY_DIR, path.basename(url));
      if (!fs.existsSync(file)) return { ok: false };
      const buf = fs.readFileSync(file);
      return {
        ok: true,
        json: async () => JSON.parse(buf.toString('utf8')),
        arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      };
    });
  });
  afterAll(() => vi.unstubAllGlobals());

  async function load(): Promise<AnnyBody> {
    const body = await loadAnnyBody('.');
    if (!body) throw new Error('export present but failed to load');
    return body;
  }

  it('loads into a 104-bone rig where every bone the fit drives resolves by label', async () => {
    const body = await load();

    expect(body.bones).toHaveLength(104);
    expect(body.labels[0]).toBe('root');
    expect(body.mesh.geometry.getAttribute('position').count).toBe(13718);
    expect(body.bone.lHip).toBe(body.labels.indexOf('upperleg01.L'));
    expect(body.bone.lToe).toBe(body.labels.indexOf('toe1-1.L'));
    for (const [name] of FOOT_LANDMARKS) expect(body.landmarks.has(name), name).toBe(true);
  });

  it('is Y-up and faces +Z, as the fit and the render camera assume', async () => {
    const body = await load();

    expect(body.rest[body.bone.head].y).toBeGreaterThan(body.rest[body.bone.lAnkle].y + 1); // ~1.4m head above ankle
    expect(body.landmarks.get('l_heel')!.y).toBeLessThan(body.rest[body.bone.lAnkle].y); // heel below the ankle bone
    expect(body.landmarks.get('l_big_toe')!.z).toBeGreaterThan(body.landmarks.get('l_heel')!.z); // toes in front of the heel
  });

  // Feeding the rig its own rest joints (including the regressed heel/toe landmarks) must move nothing:
  // any rotation here means the landmarks or bone directions disagree with the mesh they came from.
  it('fits its own rest pose to identity', async () => {
    const body = await load();
    fitAnnyToJoints(body, readJoints(body));

    expect(body.group.scale.x).toBeCloseTo(1, 5);
    for (const [, label] of HALPE_TO_LABEL) {
      expect(bone(body, label).quaternion.angleTo(new THREE.Quaternion()), label).toBeLessThan(1e-5);
    }
  });

  // On the real hierarchy the thigh is upperleg01 -> upperleg02 -> lowerleg01, so this exercises the
  // stretch chain through an actual twist bone, not the synthetic one.
  it('follows a bent knee, landing the knee, ankle and toes on the tracked points', async () => {
    const truth = await load();
    bone(truth, 'lowerleg01.L').quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.8);
    const joints = readJoints(truth);

    const body = await load();
    fitAnnyToJoints(body, joints);
    const fitted = readJoints(body);

    for (const name of ['l_knee', 'l_ankle', 'l_big_toe', 'l_heel'] as const) {
      expect(fitted.get(name)!.distanceTo(joints.get(name)!), name).toBeLessThan(1e-3);
    }
    body.group.updateMatrixWorld(true);
    const want = bone(truth, 'lowerleg01.L').getWorldQuaternion(new THREE.Quaternion());
    const got = bone(body, 'lowerleg01.L').getWorldQuaternion(new THREE.Quaternion());
    expect(got.angleTo(want)).toBeLessThan(1e-3);
  });
});
