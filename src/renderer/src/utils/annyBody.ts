import * as THREE from 'three';
import type { HALPE26_JOINT_NAMES } from './pose';

// Drives the Anny body mesh from IRIS's 3D joints. Anny is NAVER's MakeHuman-based parametric body
// (Apache 2.0 code, CC0 assets); the mesh data is exported by scripts/export_anny_mesh.py.
//
// ponytail: closed-form fit, not an optimiser. Limbs aim from the mesh's own joints at IRIS's joints and
// stretch to reach them; thigh/upper-arm roll comes from the knee/elbow bend (plus foot direction for legs);
// feet from heel + toes. Forearm/shin roll, hands and face stay at rest, and the body keeps Anny's neutral
// shape apart from limb lengths. Upgrade path: fit Anny's phenotype parameters, or use IRIS joint_angles
// once their rest frame is known.

export type HalpeName = (typeof HALPE26_JOINT_NAMES)[number];

// The bones the fit drives, by Anny (MakeHuman) label -- never by index. The export carries all 104
// labels, so a reordered or wrong export fails loudly in createRig() instead of silently driving the
// wrong bone. MakeHuman splits each limb into two bones for twist (upperleg01 -> upperleg02 ->
// lowerleg01 ...): the fit aims the first and the twist bone rides along rigidly. Three of Anny's five
// spine bones stand in for the three the chest blend needs.
const BONE = {
  pelvis: 'root',
  spine1: 'spine04', spine2: 'spine02', spine3: 'spine01',
  neck: 'neck01', head: 'head',
  lHip: 'upperleg01.L', rHip: 'upperleg01.R',
  lKnee: 'lowerleg01.L', rKnee: 'lowerleg01.R',
  lAnkle: 'foot.L', rAnkle: 'foot.R',
  lToe: 'toe1-1.L', rToe: 'toe1-1.R',
  lShoulder: 'upperarm01.L', rShoulder: 'upperarm01.R',
  lElbow: 'lowerarm01.L', rElbow: 'lowerarm01.R',
  lWrist: 'wrist.L', rWrist: 'wrist.R',
} as const;
type Role = keyof typeof BONE;
type BoneIndex = Record<Role, number>;

// Each limb bone aims from its fitted joint at IRIS's `target`; at rest it points at `child`, or at the
// rest landmark named `target` when there is one. Stretched limbs change length so the target is reached
// exactly. The neck and feet keep Anny's length: Halpe's head (top of head) and big toe (tip) aren't
// bone positions.
const LIMBS: Array<{ joint: Role; child: Role; target: HalpeName; stretch: boolean }> = [
  { joint: 'lHip', child: 'lKnee', target: 'l_knee', stretch: true },
  { joint: 'rHip', child: 'rKnee', target: 'r_knee', stretch: true },
  { joint: 'lKnee', child: 'lAnkle', target: 'l_ankle', stretch: true },
  { joint: 'rKnee', child: 'rAnkle', target: 'r_ankle', stretch: true },
  { joint: 'lAnkle', child: 'lToe', target: 'l_big_toe', stretch: false },
  { joint: 'rAnkle', child: 'rToe', target: 'r_big_toe', stretch: false },
  { joint: 'neck', child: 'head', target: 'head', stretch: false },
  { joint: 'lShoulder', child: 'lElbow', target: 'l_elbow', stretch: true },
  { joint: 'rShoulder', child: 'rElbow', target: 'r_elbow', stretch: true },
  { joint: 'lElbow', child: 'lWrist', target: 'l_wrist', stretch: true },
  { joint: 'rElbow', child: 'rWrist', target: 'r_wrist', stretch: true },
];

interface Foot { joint: Role; ankle: HalpeName; heel: HalpeName; bigToe: HalpeName; smallToe: HalpeName }
const L_FOOT_POINTS: Foot = { joint: 'lAnkle', ankle: 'l_ankle', heel: 'l_heel', bigToe: 'l_big_toe', smallToe: 'l_small_toe' };
const R_FOOT_POINTS: Foot = { joint: 'rAnkle', ankle: 'r_ankle', heel: 'r_heel', bigToe: 'r_big_toe', smallToe: 'r_small_toe' };

// Limb bones rolled about their own axis, from up to two cues:
// - bend: the joint at the end of the limb bends toward the bone's anatomical front. The export puts
//   Anny facing +Z at rest; knees bend away from it (-1), elbows towards it (+1).
// - foot: the foot points the way it does at rest relative to the bone, which still works for a straight leg.
const ROLLS: Array<{ joint: Role; bendSign?: 1 | -1; foot?: Foot }> = [
  { joint: 'lHip', bendSign: -1, foot: L_FOOT_POINTS },
  { joint: 'rHip', bendSign: -1, foot: R_FOOT_POINTS },
  { joint: 'lKnee', foot: L_FOOT_POINTS },
  { joint: 'rKnee', foot: R_FOOT_POINTS },
  { joint: 'lShoulder', bendSign: 1 },
  { joint: 'rShoulder', bendSign: 1 },
];
const FORWARD = new THREE.Vector3(0, 0, 1);
// Strength at which a roll cue fully counts: the sine of the foot's angle to the bone, or of the bend past
// the dead zone. Weaker cues fade toward the swing-only roll, since they say little about it.
const FULL_ROLL_CUE = 0.3;
// Bend (sine, beyond the rest pose's own bend) ignored for roll: about 9 degrees. Tuning knob for joint noise.
const BEND_DEAD_ZONE = 0.15;

// Segments whose lengths set the body's overall scale.
const SCALE_SEGMENTS: Array<[HalpeName, HalpeName, Role, Role]> = [
  ['pelvis', 'neck', 'pelvis', 'neck'],
  ['l_hip', 'l_knee', 'lHip', 'lKnee'], ['l_knee', 'l_ankle', 'lKnee', 'lAnkle'],
  ['r_hip', 'r_knee', 'rHip', 'rKnee'], ['r_knee', 'r_ankle', 'rKnee', 'rAnkle'],
];
// Frames averaged for the body scale and each limb length before they freeze.
const SCALE_SAMPLE_FRAMES = 30;

export interface AnnyRig {
  group: THREE.Group;
  bones: THREE.Bone[];
  rest: THREE.Vector3[];
  parents: number[];
  labels: string[];
  // BONE's roles resolved to this rig's bone indices.
  bone: BoneIndex;
  // Rest positions of mesh points matching Halpe keypoints that aren't bones (toes, heels).
  landmarks: Map<HalpeName, THREE.Vector3>;
  // Startup samples of the body scale, pooled by median once frozen.
  scaleSamples: number[];
  // Measured limb lengths in scene units, keyed by the limb's joint. Samples, not a running sum:
  // see median() on why the middle sample beats the average here.
  lengths: Map<number, number[]>;
}

export interface AnnyBody extends AnnyRig {
  mesh: THREE.SkinnedMesh;
}

// Limb lengths and body scale freeze after SCALE_SAMPLE_FRAMES and then shape the mesh for the whole
// session, so one bad startup frame is permanent. IRIS drops a limb to occlusion often enough that a
// mean gets dragged noticeably long by a few outliers (measured: 3 bad frames in 30 moved an ankle
// ~3.9cm); the median just ignores them, and a real limb length doesn't drift mid-session anyway.
function median(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function createRig(rest: THREE.Vector3[], parents: number[], labels: string[], landmarks = new Map<HalpeName, THREE.Vector3>()): AnnyRig {
  if (parents.length !== rest.length || labels.length !== rest.length) {
    throw new Error(`rig: ${rest.length} joints but ${parents.length} parents and ${labels.length} labels`);
  }
  // fitAnnyToJoints() visits bones in index order and needs every parent done first; Anny's export
  // lists them that way, with the single root at 0.
  parents.forEach((parent, i) => {
    if (parent >= i || (parent < 0) !== (i === 0)) throw new Error(`rig: bone ${i} (${labels[i]}) is out of parent-first order`);
  });
  const at = new Map(labels.map((label, i) => [label, i]));
  const bone = Object.fromEntries(
    Object.entries(BONE).map(([role, label]) => {
      const index = at.get(label);
      if (index === undefined) throw new Error(`rig has no bone '${label}' to use as ${role}`);
      return [role, index];
    }),
  ) as BoneIndex;
  if (bone.pelvis !== 0) throw new Error(`rig: expected '${BONE.pelvis}' at index 0, found ${labels[0]}`);

  const group = new THREE.Group();
  const bones = rest.map((joint, j) => {
    const b = new THREE.Bone();
    b.position.copy(parents[j] < 0 ? joint : joint.clone().sub(rest[parents[j]]));
    return b;
  });
  bones.forEach((b, j) => {
    if (parents[j] >= 0) bones[parents[j]].add(b);
  });
  group.add(bones[0]);
  return { group, bones, rest, parents, labels, bone, landmarks, scaleSamples: [], lengths: new Map() };
}

/** Forgets the measured body scale and limb lengths, e.g. after the joint positions were rescaled. */
export function resetMeasurements(rig: AnnyRig): void {
  rig.scaleSamples.length = 0;
  rig.lengths.clear();
}

/**
 * Fills in the pelvis and neck the fit anchors to, from the hip and shoulder midpoints, for layouts that
 * don't report them (COCO WholeBody-133). Only for those: a HALPE-26 neck is its own keypoint, and
 * swapping in the midpoint whenever it flickers out would jerk the torso.
 */
export function fillTorsoAnchors(joints: Map<HalpeName, THREE.Vector3>): void {
  for (const [anchor, left, right] of [['pelvis', 'l_hip', 'r_hip'], ['neck', 'l_shoulder', 'r_shoulder']] as const) {
    const l = joints.get(left), r = joints.get(right);
    if (!joints.has(anchor) && l && r) joints.set(anchor, l.clone().add(r).multiplyScalar(0.5));
  }
}

interface MeshMeta {
  vertexCount: number;
  jointCount: number;
  influences: number;
  parents: number[];
  boneLabels: string[];
  // Halpe-named rest positions regressed from the mesh (heels, toes, ...), Y-up like everything else.
  landmarks: Record<string, [number, number, number]>;
  layout: Record<string, { offset: number; length: number }>;
}

/** Loads the exported mesh, or returns null when it hasn't been exported. */
export async function loadAnnyBody(baseUrl: string): Promise<AnnyBody | null> {
  const [metaRes, binRes] = await Promise.all([
    fetch(`${baseUrl}/anny_neutral.json`),
    fetch(`${baseUrl}/anny_neutral.bin`),
  ]);
  if (!metaRes.ok || !binRes.ok) return null;
  const meta: MeshMeta = await metaRes.json();
  const bin = await binRes.arrayBuffer();

  // slice() copies each block, so typed-array byte alignment never matters.
  const block = <T>(name: string, Type: { new (buffer: ArrayBuffer): T; BYTES_PER_ELEMENT: number }): T => {
    const { offset, length } = meta.layout[name];
    return new Type(bin.slice(offset, offset + length * Type.BYTES_PER_ELEMENT));
  };

  const restFlat = block('restJoints', Float32Array);
  const rest = Array.from({ length: meta.jointCount }, (_, j) =>
    new THREE.Vector3(restFlat[j * 3], restFlat[j * 3 + 1], restFlat[j * 3 + 2]),
  );
  const landmarks = new Map(
    Object.entries(meta.landmarks).map(([name, point]) => [name as HalpeName, new THREE.Vector3().fromArray(point)]),
  );
  const rig = createRig(rest, meta.parents, meta.boneLabels, landmarks);

  const positions = block('positions', Float32Array);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(block('indices', Uint16Array), 1));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(block('skinIndices', Uint16Array), meta.influences));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(block('skinWeights', Float32Array), meta.influences));
  geometry.computeVertexNormals();

  const mesh = new THREE.SkinnedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0x9fb2d6, roughness: 0.6, metalness: 0.05 }),
  );
  mesh.frustumCulled = false; // bounds are the rest pose; the posed body moves outside them
  mesh.add(rig.bones[0]);
  rig.group.add(mesh);
  rig.group.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(rig.bones)); // bind at rest, before any pose or scale

  return { ...rig, mesh };
}

const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
const basisMatrix = new THREE.Matrix4();

// Orientation of the frame whose x axis is `primary` and y axis is `secondary` made orthogonal to it.
function basisQuaternion(primary: THREE.Vector3, secondary: THREE.Vector3): THREE.Quaternion {
  X.copy(primary).normalize();
  Y.copy(secondary).addScaledVector(X, -X.dot(secondary)).normalize();
  Z.crossVectors(X, Y);
  return new THREE.Quaternion().setFromRotationMatrix(basisMatrix.makeBasis(X, Y, Z));
}

// Rotation carrying the rest frame (restPrimary, restSecondary) onto the observed one.
function frameRotation(primary: THREE.Vector3, secondary: THREE.Vector3, restPrimary: THREE.Vector3, restSecondary: THREE.Vector3): THREE.Quaternion {
  return basisQuaternion(primary, secondary).multiply(basisQuaternion(restPrimary, restSecondary).invert());
}

// The part of `v` perpendicular to the unit `axis`, as a new vector.
function perpendicular(v: THREE.Vector3, axis: THREE.Vector3): THREE.Vector3 {
  return v.clone().addScaledVector(axis, -v.dot(axis));
}

// Signed angle about the unit `axis` turning `from` toward `to` (both taken perpendicular to it).
function angleAbout(from: THREE.Vector3, to: THREE.Vector3, axis: THREE.Vector3): number {
  return Math.atan2(from.clone().cross(to).dot(axis), perpendicular(from, axis).dot(to));
}

function footForward(foot: Foot, point: (name: HalpeName) => THREE.Vector3 | undefined): THREE.Vector3 | null {
  const bigToe = point(foot.bigToe), smallToe = point(foot.smallToe), back = point(foot.heel) ?? point(foot.ankle);
  if (!bigToe || !back) return null;
  const tip = smallToe ? bigToe.clone().add(smallToe).multiplyScalar(0.5) : bigToe.clone();
  return tip.sub(back).normalize();
}

// The bones from just below `joint` down to `end`, following parents -- one bone normally, two where
// MakeHuman's twist bone sits between them.
function chain(parents: number[], joint: number, end: number): number[] {
  const links: number[] = [];
  for (let b = end; b !== joint; b = parents[b]) {
    if (b < 0) throw new Error(`rig: bone ${end} does not descend from ${joint}`);
    links.push(b);
  }
  return links;
}

/**
 * Poses the rig so its bones follow IRIS's joints. `joints` holds only valid
 * joints, in scene units. Bones whose joints are missing keep their last pose.
 */
export function fitAnnyToJoints(rig: AnnyRig, joints: Map<HalpeName, THREE.Vector3>): void {
  const { bones, rest, parents, landmarks, bone: B } = rig;
  const j = (name: HalpeName) => joints.get(name);
  const pelvis = j('pelvis'), lHip = j('l_hip'), rHip = j('r_hip'), neck = j('neck');
  if (!pelvis || !lHip || !rHip || !neck) return; // no torso, nothing to anchor to

  // Scale: median of observed/rest segment lengths, frozen after enough frames.
  if (rig.scaleSamples.length < SCALE_SAMPLE_FRAMES) {
    let observed = 0, restLength = 0;
    for (const [a, b, ra, rb] of SCALE_SEGMENTS) {
      const pa = j(a), pb = j(b);
      if (!pa || !pb) continue;
      observed += pa.distanceTo(pb);
      restLength += rest[B[ra]].distanceTo(rest[B[rb]]);
    }
    if (restLength > 0) rig.scaleSamples.push(observed / restLength);
  }
  const scale = median(rig.scaleSamples) ?? 1;
  rig.group.scale.setScalar(scale);

  const restUp = rest[B.neck].clone().sub(rest[B.pelvis]);
  const up = neck.clone().sub(pelvis);
  const world: THREE.Quaternion[] = [];
  world[B.pelvis] = frameRotation(lHip.clone().sub(rHip), up, rest[B.lHip].clone().sub(rest[B.rHip]), restUp);

  // World rotations set directly from a measured frame rather than aimed.
  const targets = new Map<number, THREE.Quaternion>();
  const lShoulder = j('l_shoulder'), rShoulder = j('r_shoulder');
  if (lShoulder && rShoulder) {
    const chest = frameRotation(lShoulder.clone().sub(rShoulder), up, rest[B.lShoulder].clone().sub(rest[B.rShoulder]), restUp);
    targets.set(B.spine1, world[B.pelvis].clone().slerp(chest, 1 / 3));
    targets.set(B.spine2, world[B.pelvis].clone().slerp(chest, 2 / 3));
    targets.set(B.spine3, chest);
  }
  for (const foot of [L_FOOT_POINTS, R_FOOT_POINTS]) {
    const heel = j(foot.heel), bigToe = j(foot.bigToe), smallToe = j(foot.smallToe);
    const restHeel = landmarks.get(foot.heel), restBig = landmarks.get(foot.bigToe), restSmall = landmarks.get(foot.smallToe);
    if (!heel || !bigToe || !smallToe || !restHeel || !restBig || !restSmall) continue; // falls back to aiming at the big toe
    targets.set(B[foot.joint], frameRotation(
      bigToe.clone().add(smallToe).multiplyScalar(0.5).sub(heel), bigToe.clone().sub(smallToe),
      restBig.clone().add(restSmall).multiplyScalar(0.5).sub(restHeel), restBig.clone().sub(restSmall),
    ));
  }

  const limbs = new Map(LIMBS.map((limb) => [B[limb.joint], limb]));
  const rolls = new Map(ROLLS.map((roll) => [B[roll.joint], roll]));
  const restDirection = new THREE.Vector3();
  const forward = new THREE.Vector3();

  bones[B.pelvis].quaternion.copy(world[B.pelvis]);
  bones[B.pelvis].position.copy(pelvis).divideScalar(scale);
  // Fitted joint positions, in the group's (unscaled) units. createRig() guarantees the pelvis is bone 0.
  const position: THREE.Vector3[] = [bones[B.pelvis].position.clone()];

  // Parents always have lower indices (checked in createRig), so one pass visits parents first.
  for (let i = 1; i < bones.length; i += 1) {
    const parentWorld = world[parents[i]];
    position[i] = bones[i].position.clone().applyQuaternion(parentWorld).add(position[parents[i]]);
    const limb = limbs.get(i);
    const target = limb && j(limb.target);

    if (targets.has(i)) {
      world[i] = targets.get(i)!;
    } else if (limb && target) {
      const child = B[limb.child];
      // Aiming from the mesh's own joint (not IRIS's) absorbs landmark offsets, e.g. COCO hips sit wider than the rig's.
      const aim = target.clone().divideScalar(scale).sub(position[i]);
      const direction = aim.clone().normalize();

      if (limb.stretch) {
        let measured = rig.lengths.get(i);
        if (!measured) rig.lengths.set(i, (measured = []));
        if (measured.length < SCALE_SAMPLE_FRAMES) measured.push(aim.length() * scale);
        // One factor on every offset between this joint and the child: the child lands at the measured
        // distance whether or not a twist bone sits in between, and the chain keeps its rest shape.
        const factor = median(measured)! / scale / rest[child].distanceTo(rest[i]);
        for (const link of chain(parents, i, child)) {
          bones[link].position.copy(rest[link]).sub(rest[parents[link]]).multiplyScalar(factor);
        }
      }

      // Rest bones have identity rotation, so the inherited direction is the parent's rotation of the rest offset.
      // A stretched limb's target is a bone, so aim at the bone: the export also carries a regressed keypoint
      // for every joint, and aiming at those instead put a constant ~3deg bias on each limb at rest.
      // Landmarks are for the targets that have no bone (big toe, top of head).
      const restTarget = limb.stretch ? rest[child] : (landmarks.get(limb.target) ?? rest[child]);
      restDirection.copy(restTarget).sub(rest[i]).applyQuaternion(parentWorld).normalize();
      world[i] = new THREE.Quaternion().setFromUnitVectors(restDirection, direction).multiply(parentWorld);

      const roll = rolls.get(i);
      if (roll) {
        // Swing leaves the roll about the bone arbitrary. Each cue proposes a roll angle; they're averaged by weight.
        let sin = 0, cos = 0, strength = 0;
        const propose = (restVector: THREE.Vector3, observed: THREE.Vector3, weight: number) => {
          weight = Math.min(1, Math.max(0, weight));
          const angle = angleAbout(forward.copy(restVector).applyQuaternion(world[i]), observed, direction);
          sin += weight * Math.sin(angle);
          cos += weight * Math.cos(angle);
          strength += weight;
        };

        const restLimb = rest[child].clone().sub(rest[i]).normalize();
        const lower = limbs.get(child);
        const end = lower && j(lower.target);
        if (roll.bendSign && lower && end) {
          const bend = perpendicular(end.clone().sub(target).normalize(), direction);
          const restBend = perpendicular(rest[B[lower.child]].clone().sub(rest[child]).normalize(), restLimb).length();
          // Only bend clearly beyond the rest pose's own slight bend counts: the rest pose shouldn't roll itself,
          // and a few degrees of bend from joint noise or scale error point nowhere in particular.
          const weight = (bend.length() - restBend - BEND_DEAD_ZONE) / FULL_ROLL_CUE;
          propose(FORWARD, bend.multiplyScalar(roll.bendSign), weight);
        }
        if (roll.foot) {
          const foot = roll.foot;
          // The ankle is a bone, so it comes from the rig even though the export regresses a keypoint for it too.
          const restPoint = (name: HalpeName) => (name === foot.ankle ? rest[B[foot.joint]] : landmarks.get(name));
          // Use the same foot points at rest and now, so a missing heel doesn't read as a turned foot.
          const shared = (name: HalpeName) => j(name) !== undefined && restPoint(name) !== undefined;
          const toes = footForward(foot, (name) => (shared(name) ? j(name) : undefined));
          const restToes = footForward(foot, (name) => (shared(name) ? restPoint(name) : undefined));
          if (toes && restToes) {
            const observedToes = perpendicular(toes, direction);
            propose(perpendicular(restToes, restLimb), observedToes, observedToes.length() / FULL_ROLL_CUE);
          }
        }

        if (strength > 0) {
          const angle = Math.atan2(sin, cos) * Math.min(1, strength);
          world[i] = new THREE.Quaternion().setFromAxisAngle(direction, angle).multiply(world[i]);
        }
      }
    } else {
      // Not fitted (twist bones, fingers, face, collars) or its joints are missing: keep the current local pose.
      world[i] = parentWorld.clone().multiply(bones[i].quaternion);
      continue;
    }
    bones[i].quaternion.copy(parentWorld.clone().invert().multiply(world[i]));
  }
}
