import type { PoseLayout } from './poseModels';

export const HALPE26_JOINT_NAMES = [
  'nose', 'l_eye', 'r_eye', 'l_ear', 'r_ear',
  'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
  'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle',
  'head', 'neck', 'pelvis',
  'l_big_toe', 'r_big_toe', 'l_small_toe', 'r_small_toe', 'l_heel', 'r_heel',
] as const;

const HALPE_BONES: Array<[string, string]> = [
  ['nose', 'l_eye'], ['nose', 'r_eye'], ['l_eye', 'l_ear'], ['r_eye', 'r_ear'],
  ['head', 'neck'], ['neck', 'l_shoulder'], ['neck', 'r_shoulder'],
  ['l_shoulder', 'l_elbow'], ['l_elbow', 'l_wrist'],
  ['r_shoulder', 'r_elbow'], ['r_elbow', 'r_wrist'],
  ['l_shoulder', 'r_shoulder'],
  ['l_hip', 'r_hip'],
  ['l_hip', 'l_knee'], ['l_knee', 'l_ankle'],
  ['r_hip', 'r_knee'], ['r_knee', 'r_ankle'],
  ['neck', 'pelvis'], ['pelvis', 'l_hip'], ['pelvis', 'r_hip'],
  ['l_ankle', 'l_big_toe'], ['l_ankle', 'l_small_toe'], ['l_ankle', 'l_heel'],
  ['r_ankle', 'r_big_toe'], ['r_ankle', 'r_small_toe'], ['r_ankle', 'r_heel'],
];

const BODY_NAMES = HALPE26_JOINT_NAMES.slice(0, 17);
const bodyNames: ReadonlySet<string> = new Set(BODY_NAMES);
const BODY_BONES = HALPE_BONES.filter(([a, b]) => bodyNames.has(a) && bodyNames.has(b));
BODY_BONES.push(['l_shoulder', 'l_hip'], ['r_shoulder', 'r_hip']);
const WHOLEBODY_NAMES = [
  ...BODY_NAMES,
  'l_big_toe', 'l_small_toe', 'l_heel', 'r_big_toe', 'r_small_toe', 'r_heel',
  ...Array.from({ length: 68 }, (_, i) => `face_${i}`),
  ...['l', 'r'].flatMap(side => Array.from({ length: 21 }, (_, i) => `${side}_hand_${i}`)),
];
const WHOLEBODY_BONES: Array<[string, string]> = [...BODY_BONES];
for (const side of ['l', 'r']) {
  for (const part of ['big_toe', 'small_toe', 'heel']) WHOLEBODY_BONES.push([`${side}_ankle`, `${side}_${part}`]);
  WHOLEBODY_BONES.push([`${side}_wrist`, `${side}_hand_0`]);
  for (let finger = 0; finger < 5; finger++) {
    const first = 1 + finger * 4;
    WHOLEBODY_BONES.push([`${side}_hand_0`, `${side}_hand_${first}`]);
    for (let j = first; j < first + 3; j++) WHOLEBODY_BONES.push([`${side}_hand_${j}`, `${side}_hand_${j + 1}`]);
  }
}
// Facial contours; keep separate contours disconnected.
for (const [start, end, closed] of [[0, 16, 0], [17, 21, 0], [22, 26, 0], [27, 30, 0], [31, 35, 0],
  [36, 41, 1], [42, 47, 1], [48, 59, 1], [60, 67, 1]]) {
  for (let j = start!; j < end!; j++) WHOLEBODY_BONES.push([`face_${j}`, `face_${j + 1}`]);
  if (closed) WHOLEBODY_BONES.push([`face_${end}`, `face_${start}`]);
}

export interface Skeleton { names: readonly string[]; bones: Array<[string, string]> }
export const SKELETONS: Record<PoseLayout, Skeleton> = {
  halpe26: { names: HALPE26_JOINT_NAMES, bones: HALPE_BONES },
  coco133: { names: WHOLEBODY_NAMES, bones: WHOLEBODY_BONES },
};
