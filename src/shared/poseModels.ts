export const POSE_MODELS = [
  { id: 'rtmpose-halpe26', label: 'Extended body · 26 keypoints', description: 'RTMPose · HALPE-26', layout: 'halpe26', keypoints: 26,
    engine: 'rtmpose_bs16_fp16.trt', width: 192, height: 256 },
  { id: 'rtmw-coco133', label: 'Whole body · 133 keypoints', description: 'RTMW · Body, feet, hands and face', layout: 'coco133', keypoints: 133,
    engine: 'rtmw_l384_bs16_fp16.trt', width: 288, height: 384 },
] as const;

export type PoseModelId = typeof POSE_MODELS[number]['id'];
export type PoseLayout = typeof POSE_MODELS[number]['layout'];
export const DEFAULT_POSE_MODEL: PoseModelId = 'rtmpose-halpe26';
export interface PoseModelAvailability { id: PoseModelId; available: boolean; reason?: string }

export function poseModel(id: unknown = DEFAULT_POSE_MODEL) {
  const model = POSE_MODELS.find(model => model.id === id);
  if (!model) throw new Error(`Unknown pose model: ${String(id)}`);
  return model;
}
