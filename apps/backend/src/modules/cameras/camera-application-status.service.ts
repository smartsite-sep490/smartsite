import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { readCameraApplicationStatus } from './camera-application-status.js';

@Injectable()
export class CameraApplicationStatusService {
  constructor(private readonly source: DataSource) {}

  read(siteId: string, cameraId: string) {
    return readCameraApplicationStatus(this.source, siteId, cameraId, 60_000);
  }
}
