export const polarAirBranding = Object.freeze({
  id: 'polar_air',
  companyName: 'Polar Air',
  license: 'ROC 359982',
  phone: '(480) 788-1624',
  logoPath: '/assets/branding/polar-air-logo.jpg',
  proposalTitle: 'HVAC Replacement Proposal',
  legalDisclaimer:
    'This estimate is based on visible and accessible conditions at the time of quote. It is not a guarantee of future system performance. Additional scope discovered after approval will be documented and approved before work proceeds.',
  warrantyBlurb:
    'Manufacturer warranty coverage varies by product family. Standard mini-split options are configured to include a 10-Year Parts and 10-Year Compressor warranty when applicable. Polar Air also provides a 1-year workmanship labor warranty from install date.',
  defaultScopeSummary:
    'This proposal outlines equipment and installation options tailored for your property. Select the option that best fits your comfort, efficiency, and budget goals.',
  includedItems: Object.freeze([
    'Professional installation by a licensed HVAC technician.',
    'All standard refrigerant and control interconnects between indoor and outdoor units.',
    'System evacuation, pressure testing, startup, and commissioning.',
    'Post-installation functional testing and homeowner walkthrough.',
    'One (1) year labor warranty from date of installation.',
  ]),
  excludedItems: Object.freeze([
    'Drywall, paint, texture, framing, or finish carpentry repairs.',
    'Main electrical panel upgrades unless explicitly listed.',
    'Weekend/after-hours installation unless explicitly listed.',
    'Code-required upgrades not visible/known at time of estimate.',
  ]),
  nextSteps:
    'To proceed, reply with your preferred option and requested installation timing. We will finalize scheduling and any scope clarifications before contract signature.',
});

export function getBrandingProfile() {
  return polarAirBranding;
}
