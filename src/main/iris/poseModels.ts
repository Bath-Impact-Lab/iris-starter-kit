import fs from 'node:fs';
import path from 'node:path';
import { POSE_MODELS, poseModel, type PoseModelAvailability } from '../../shared/poseModels';
import { getIrisModelDir } from './config';

export function listPoseModels(modelDir = getIrisModelDir()): PoseModelAvailability[] {
  return POSE_MODELS.map(model => {
    const available = fs.existsSync(path.join(modelDir, model.engine));
    return { id: model.id, available, ...(!available ? { reason: 'Model engine not installed' } : {}) };
  });
}

export function validatePoseModel(id: unknown, modelDir = getIrisModelDir()) {
  const model = poseModel(id);
  if (!fs.existsSync(path.join(modelDir, model.engine))) {
    throw new Error(`${model.label}: install ${model.engine} in ${modelDir}`);
  }
  return model;
}
