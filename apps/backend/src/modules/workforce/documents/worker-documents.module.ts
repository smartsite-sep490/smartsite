import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module.js';
import { StorageModule } from '../../../integrations/storage/storage.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { WorkforceDirectoryModule } from '../directory/directory.module.js';
import { WorkerDocumentsController } from './worker-documents.controller.js';
import { WorkerDocumentsService } from './worker-documents.service.js';
import { DocumentNotificationsService } from './document-notifications.service.js';
import { DocumentAnalysisService } from './document-analysis.service.js';
@Module({
  imports: [DatabaseModule, StorageModule, AuthModule, WorkforceDirectoryModule],
  controllers: [WorkerDocumentsController],
  providers: [WorkerDocumentsService, DocumentNotificationsService, DocumentAnalysisService],
})
export class WorkerDocumentsModule {}
