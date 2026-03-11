import {
  getGoogleDriveConfigSummary,
  listDriveFiles,
  uploadDriveFile,
  downloadDriveFile,
} from '../google-drive.js';

export function getConfig() {
  return getGoogleDriveConfigSummary();
}

export async function listFiles(opts = {}) {
  return listDriveFiles(opts);
}

export async function uploadFile(opts = {}) {
  return uploadDriveFile(opts);
}

export async function downloadFile(opts = {}) {
  return downloadDriveFile(opts);
}
