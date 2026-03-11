/**
 * Zod input schemas for MCP tools. Used for validation and (via toJSONSchema) tool discovery.
 */

import { z } from 'zod';

export const housecallGetConfigInput = z.object({});

export const housecallTestConnectionInput = z.object({
  path: z.string().optional(),
});

export const housecallRequestInput = z.object({
  method: z.string().optional(),
  path: z.string().min(1),
  query: z.record(z.string(), z.unknown()).optional(),
  body: z.unknown().optional(),
  headers: z.record(z.string(), z.unknown()).optional(),
}).refine((data) => {
  const p = data.path || '';
  return /^\/v\d+\//.test(p) || p.startsWith('https://') || p.startsWith('http://');
}, { message: 'path must start with /v<version>/ or be absolute URL', path: ['path'] });

export const housecallListCustomersInput = z.object({
  search: z.string().optional(),
  page_size: z.number().optional(),
  page: z.number().optional(),
});

export const housecallResolveContextInput = z.object({
  appointment_id: z.string().min(1),
  appointment_lookup_path: z.string().optional(),
  appointment_lookup_method: z.string().optional(),
  appointment_lookup_query: z.record(z.string(), z.unknown()).optional(),
});

export const catalogGetReportInput = z.object({});

export const catalogLoadInput = z.object({
  profile: z.string().optional(),
});

export const catalogGetItemBySkuInput = z.object({
  sku: z.string().min(1),
  profile: z.string().optional(),
});

export const catalogQueryByAttributeInput = z.object({
  attribute_key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  profile: z.string().optional(),
});

export const schedulerResolveContextInput = z.object({
  appointment_id: z.string().min(1),
  appointment_lookup_path: z.string().optional(),
  appointment_lookup_method: z.string().optional(),
  appointment_lookup_query: z.record(z.string(), z.unknown()).optional(),
});

export const gdriveGetConfigInput = z.object({});
export const gdriveListFilesInput = z.object({
  q: z.string().optional(),
  page_size: z.number().int().positive().max(1000).optional(),
  page_token: z.string().optional(),
  folder_id: z.string().optional(),
  shared_drive_id: z.string().optional(),
  order_by: z.string().optional(),
  fields: z.string().optional(),
});
export const gdriveUploadFileInput = z.object({
  name: z.string().min(1),
  content_base64: z.string().min(1),
  mime_type: z.string().optional(),
  folder_id: z.string().optional(),
  shared_drive_id: z.string().optional(),
});
export const gdriveDownloadFileInput = z.object({
  file_id: z.string().min(1),
  shared_drive_id: z.string().optional(),
});
export const codexGetUsageInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

/** Map tool name -> Zod schema */
export const toolInputSchemas = {
  'housecall.get_config': housecallGetConfigInput,
  'housecall.test_connection': housecallTestConnectionInput,
  'housecall.request': housecallRequestInput,
  'housecall.list_customers': housecallListCustomersInput,
  'housecall.resolve_context': housecallResolveContextInput,
  'catalog.get_report': catalogGetReportInput,
  'catalog.load': catalogLoadInput,
  'catalog.get_item_by_sku': catalogGetItemBySkuInput,
  'catalog.query_by_attribute': catalogQueryByAttributeInput,
  'scheduler.resolve_context': schedulerResolveContextInput,
  'gdrive.get_config': gdriveGetConfigInput,
  'gdrive.list_files': gdriveListFilesInput,
  'gdrive.upload_file': gdriveUploadFileInput,
  'gdrive.download_file': gdriveDownloadFileInput,
  'codex.get_usage': codexGetUsageInput,
};
