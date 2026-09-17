import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildConfigFromOptions } from './config';
import { listPoseModels, validatePoseModel } from './poseModels';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));

describe('pose model configuration', () => {
  it.each([
    ['rtmpose-halpe26', 'rtmpose_bs16_fp16.trt', 192, 256, 26],
    ['rtmw-coco133', 'rtmw_l384_bs16_fp16.trt', 288, 384, 133],
  ])('configures the complete %s preset', (id, engine, width, height, count) => {
    const config = buildConfigFromOptions({ pose_model: id });
    const model = config.shared.models.pose[config.pipeline.pose_estimation.model];
    expect(model).toMatchObject({ input_w: width, input_h: height, num_keypoints: count, batch: 16, split_ratio: 2 });
    expect(model.engine).toMatch(new RegExp(`/${engine}$`));
  });

  it('preserves the bundled HALPE-26 model by default and rejects unknown IDs', () => {
    expect(buildConfigFromOptions().shared.models.pose.rtmpose_people.num_keypoints).toBe(26);
    expect(() => buildConfigFromOptions({ pose_model: '../custom.trt' })).toThrow('Unknown pose model');
  });

  it('reports missing engines and rechecks availability before launch', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'iris-models-'));
    directories.push(dir);
    expect(listPoseModels(dir).every(model => !model.available)).toBe(true);
    const file = path.join(dir, 'rtmpose_bs16_fp16.trt');
    writeFileSync(file, 'test engine');
    expect(listPoseModels(dir).filter(model => model.available).map(model => model.id)).toEqual(['rtmpose-halpe26']);
    expect(validatePoseModel('rtmpose-halpe26', dir).keypoints).toBe(26);
    rmSync(file);
    expect(() => validatePoseModel('rtmpose-halpe26', dir)).toThrow('install rtmpose_bs16_fp16.trt');
  });
});
