/**
 * Request body validation schemas (Zod) for bridge endpoints.
 * Validates required fields and types; allows optional fields for backward compatibility.
 */

import { z } from 'zod';

const estimateTypeSchema = z.enum(['changeout', 'new_build']);
const pricingModeSchema = z.enum(['budget', 'standard', 'detailed']);
const optionalObject = z.record(z.string(), z.unknown()).optional();

const newBuildSystemSchema = z.object({
  systemId: z.string().optional(),
  equipmentSku: z.string().optional(),
  equipmentType: z.string().optional(),
  tonnage: z.number().optional(),
  efficiencyTier: z.string().optional(),
  heatType: z.string().optional(),
  systemLocation: z.string().optional(),
  lineSetLength: z.number().optional(),
  condensateDrainLength: z.number().optional(),
  returnCount: z.number().optional(),
  filterBaseIncluded: z.boolean().optional(),
  thermostatType: z.string().optional(),
  zoneCount: z.number().optional(),
  laborDifficultyModifier: z.number().optional(),
}).passthrough();

const newBuildAirDistributionSchema = z.object({
  supplyRegisterCount: z.number().optional(),
  returnGrilleCount: z.number().optional(),
  returnBoxCount: z.number().optional(),
  supplyBootCount: z.number().optional(),
  returnBootCount: z.number().optional(),
  flexRunCount: z.number().optional(),
  flexRunTotalLength: z.number().optional(),
  hardDuctLinearFeet: z.number().optional(),
  trunkLineLinearFeet14: z.number().optional(),
  trunkLineLinearFeet12: z.number().optional(),
  trunkLineLinearFeet10: z.number().optional(),
  trunkLineLinearFeet8: z.number().optional(),
  ductTransitionsCount: z.number().optional(),
  balancingDamperCount: z.number().optional(),
}).passthrough();

const newBuildVentilationSchema = z.object({
  bathFanCount: z.number().optional(),
  dryerVentCount: z.number().optional(),
  rangeHoodVentCount: z.number().optional(),
  freshAirKitCount: z.number().optional(),
  exhaustRoofCapCount: z.number().optional(),
  exhaustWallCapCount: z.number().optional(),
}).passthrough();

const newBuildAddersSchema = z.object({
  permitRequired: z.boolean().optional(),
  craneRequired: z.boolean().optional(),
  atticDifficulty: z.enum(['easy', 'standard', 'difficult']).optional(),
  stories: z.union([z.literal(1), z.literal(2), z.literal('3+'), z.literal(3)]).optional(),
  condensatePumpCount: z.number().optional(),
  floatSwitchCount: z.number().optional(),
  secondaryDrainPanCount: z.number().optional(),
  disconnectCount: z.number().optional(),
  whipCount: z.number().optional(),
  padCount: z.number().optional(),
  craneAdder: z.number().optional(),
  highCeilingAdder: z.number().optional(),
  longLineSetAdder: z.number().optional(),
  difficultAtticAdder: z.number().optional(),
  twoStoryAdder: z.number().optional(),
  premiumGrilleAdder: z.number().optional(),
  startupCommissioningAdder: z.number().optional(),
}).passthrough();

const newBuildManualOverridesSchema = z.object({
  equipmentSubtotal: z.number().optional(),
  airDistributionSubtotal: z.number().optional(),
  ventilationSubtotal: z.number().optional(),
  addersSubtotal: z.number().optional(),
  jobCostSubtotal: z.number().optional(),
  lineItems: z.record(z.string(), z.object({
    quantity: z.number().optional(),
    unitCost: z.number().optional(),
    laborHoursPerUnit: z.number().optional(),
  })).optional(),
}).passthrough();

const newBuildPayloadSchema = z.object({
  projectName: z.string().optional(),
  builderName: z.string().optional(),
  address: z.string().optional(),
  squareFootage: z.number().optional(),
  stories: z.union([z.literal(1), z.literal(2), z.literal('3+'), z.literal(3)]).optional(),
  atticDifficulty: z.enum(['easy', 'standard', 'difficult']).optional(),
  installType: z.enum(['rough_in_only', 'rough_in_plus_trim', 'full_install']).optional(),
  ductType: z.enum(['flex', 'hard_duct', 'mixed']).optional(),
  zoning: z.boolean().optional(),
  permitRequired: z.boolean().optional(),
  craneRequired: z.boolean().optional(),
  systems: z.array(newBuildSystemSchema).optional(),
  airDistribution: newBuildAirDistributionSchema.optional(),
  ventilation: newBuildVentilationSchema.optional(),
  adders: newBuildAddersSchema.optional(),
  manualOverrides: newBuildManualOverridesSchema.optional(),
  pricingTableOverrides: optionalObject,
}).passthrough();

// ----- /chat -----
export const chatBodySchema = z.object({
  user_id: z.string().min(1, 'user_id is required'),
  message: z.string().optional(),
  text: z.string().optional(),
  async: z.boolean().optional(),
}).refine((data) => data.message !== undefined || data.text !== undefined, {
  message: 'message or text is required',
  path: ['message'],
});

// ----- /estimator/changeout-plan -----
export const changeoutPlanBodySchema = z.object({
  user_id: z.string().min(1, 'user_id is required').optional(),
  estimateType: estimateTypeSchema.optional(),
  pricing_mode: pricingModeSchema.optional(),
  catalog_profile: z.string().optional(),
  use_imported_catalog: z.boolean().optional(),
  include_user_catalog: z.boolean().optional(),
  refresh_import_catalog: z.boolean().optional(),
  labor_context: optionalObject,
  intake: optionalObject,
  customer: optionalObject,
  project: optionalObject,
  limit: z.number().optional(),
});

// ----- /estimator/estimate -----
export const estimateBodySchema = z.object({
  user_id: z.string().min(1, 'user_id is required').optional(),
  estimateType: estimateTypeSchema.optional(),
  pricing_mode: pricingModeSchema.optional(),
  catalog_profile: z.string().optional(),
  use_imported_catalog: z.boolean().optional(),
  include_user_catalog: z.boolean().optional(),
  refresh_import_catalog: z.boolean().optional(),
  labor_context: optionalObject,
  selections: z.array(z.record(z.string(), z.unknown())).optional(),
  manual_items: z.array(z.record(z.string(), z.unknown())).optional(),
  customer: optionalObject,
  project: optionalObject,
  adjustments: optionalObject,
  new_build: newBuildPayloadSchema.optional(),
  output: z.enum(['json', 'html']).optional(),
});

// ----- /estimator/export/housecall -----
export const exportHousecallBodySchema = z.object({
  user_id: z.string().min(1, 'user_id is required').optional(),
  estimateType: estimateTypeSchema.optional(),
  pricing_mode: pricingModeSchema.optional(),
  idempotency_key: z.string().min(1).optional(),
  labor_context: optionalObject,
  customer: optionalObject,
  project: optionalObject,
  estimate: optionalObject,
  selections: z.array(z.record(z.string(), z.unknown())).optional(),
  manual_items: z.array(z.record(z.string(), z.unknown())).optional(),
  housecall: optionalObject,
  adjustments: optionalObject,
  new_build: newBuildPayloadSchema.optional(),
  catalog_profile: z.string().optional(),
  use_imported_catalog: z.boolean().optional(),
  include_user_catalog: z.boolean().optional(),
  refresh_import_catalog: z.boolean().optional(),
});

// ----- /integrations/housecall/request -----
export const housecallRequestBodySchema = z.object({
  method: z.string().optional(),
  path: z.string().min(1, 'path is required'),
  query: z.record(z.string(), z.unknown()).optional(),
  body: z.unknown().optional(),
  headers: z.record(z.string(), z.unknown()).optional(),
}).refine((data) => {
  const path = data.path || '';
  return path.startsWith('/') || path.startsWith('https://') || path.startsWith('http://');
}, { message: 'path must start with / or be an absolute URL', path: ['path'] });

// ----- /integrations/gdrive/upload -----
export const gdriveUploadBodySchema = z.object({
  name: z.string().min(1, 'name is required'),
  content_base64: z.string().min(1, 'content_base64 is required'),
  mime_type: z.string().optional(),
  folder_id: z.string().optional(),
  shared_drive_id: z.string().optional(),
});

/**
 * Format Zod errors into 400 response shape with field-level details.
 * @param {import('zod').ZodError} err
 * @returns {{ error: string, details: Array<{ path: string[], message: string }> }}
 */
export function formatValidationError(err) {
  const issues = err.issues ?? err.errors ?? [];
  const details = issues.map((e) => ({
    path: (e.path || []).map(String),
    message: e.message || 'Invalid value',
  }));
  const first = details[0];
  const error = first ? `${first.path.length ? first.path.join('.') + ': ' : ''}${first.message}` : 'Validation failed';
  return { error, details };
}
