import type { JurisdictionPack } from "./types";

/**
 * Ventura County, CA — the reference jurisdiction (the demo parcels live here).
 *
 * Every URL below was fetched and returned HTTP 200 on 2026-08-23 (PDFs also
 * confirmed `content-type: application/pdf`), and each carries its own
 * per-link verification record (re-checked 2026-08-25 via
 * scripts/check-jurisdiction-links.mjs; the 3 fire.venturacounty.gov pages
 * 403 scripted HEAD requests — WAF bot-blocking — but load in browsers).
 * Sources: venturacounty.gov
 * (RMA Planning, Building & Safety, Fire), sce.com, cpuc.ca.gov.
 *
 * Researched facts that shaped this pack:
 *  - CEQA review is not a separate application — it is triggered by filing the
 *    discretionary permit application; the Initial Study Checklist Template is
 *    the working document.
 *  - VCFD publishes NO BESS/NFPA 855-specific standard — BESS fire submittals
 *    go in on Form 610 and are reviewed against CA Fire Code Ch. 12 / NFPA 855
 *    directly (recorded as a phase note, not a guessed link).
 *  - Building & Safety publishes a PV plan-check handout but no BESS-specific
 *    building handout (recorded as a phase note).
 *  - No CEC/CPUC permit application belongs to a county-permitted solar+BESS
 *    package; SCE interconnection is filed through the GIPT portal.
 */
export const VENTURA: JurisdictionPack = {
  county: "Ventura",
  state: "CA",
  verifiedAt: "2026-08-23",
  portal: {
    title: "VC Citizen Access — county permit portal",
    url: "https://vcca.venturacounty.gov/",
    phase: "entitlement",
    kind: "portal",
    authority: "County of Ventura (Accela)",
    whatFor:
      "The county's online permit portal — file and track planning, building, and fire applications, upload documents, pay fees.",
    verifiedAt: "2026-08-25",
    verifyStatus: "ok",
  },
  resources: [
    // ---- Entitlement / Planning ------------------------------------------
    {
      title: "Discretionary Permit Application Packet",
      url: "https://rmadocs.venturacounty.gov/planning/forms/planning-discretionary-entitlement-zone-change-and-subdivision-application-packet.pdf",
      phase: "entitlement",
      kind: "form",
      authority: "Ventura County RMA Planning Division",
      whatFor:
        "The core entitlement application — Conditional Use Permit / Planned Development Permit / zone change for the project.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "Section III — Documents and Studies Required with Application",
      url: "https://rmadocs.venturacounty.gov/planning/publications/planning-section-III-entitlement-zone-change-subdivision-application-questionnaire.pdf",
      phase: "entitlement",
      kind: "checklist",
      authority: "Ventura County RMA Planning Division",
      whatFor:
        "The submittal checklist of studies and documents that must accompany the entitlement application.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "Acknowledgement of Acreage Limitation (Energy Storage Projects)",
      url: "https://rmadocs.venturacounty.gov/planning/forms/planning-acknowledgment-of-acres-limitation.pdf",
      phase: "entitlement",
      kind: "form",
      authority: "Ventura County RMA Planning Division",
      whatFor:
        "County form filed specifically with entitlement applications for energy-storage projects.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "Discretionary Project Reimbursement Agreement",
      url: "https://rmadocs.venturacounty.gov/planning/forms/planning-discretionary-project-reimbursement-agreement.pdf",
      phase: "entitlement",
      kind: "form",
      authority: "Ventura County RMA Planning Division",
      whatFor:
        "Cost-recovery agreement filed with the discretionary permit application.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "Discretionary Approvals — process & pre-application meeting",
      url: "https://rma.venturacounty.gov/divisions/planning/discretionary-approvals/",
      phase: "entitlement",
      kind: "page",
      authority: "Ventura County RMA Planning Division",
      whatFor:
        "Process hub: the pre-application meeting with the Discretionary Permit Coordinator produces the project-specific submittal-requirements list.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },

    // ---- Environmental / CEQA --------------------------------------------
    {
      title: "CEQA Resources and Guidelines",
      url: "https://rma.venturacounty.gov/divisions/planning/california-environmental-quality-act-resources-and-guidelines/",
      phase: "environmental",
      kind: "page",
      authority: "Ventura County RMA Planning Division",
      whatFor:
        "Official CEQA page hosting the county's review templates; CEQA review is triggered by the entitlement filing, not a separate application.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "Ventura County Initial Study Checklist Template",
      url: "https://rmadocs.venturacounty.gov/planning/programs/california-environmental-quality-act/publications/ventura-county-initial-study-assessment-template.pdf",
      phase: "environmental",
      kind: "checklist",
      authority: "Ventura County RMA Planning Division",
      whatFor:
        "The blank Initial Study template used to analyze the project against ISAG thresholds.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "2025 Initial Study Assessment Guidelines (ISAGs)",
      url: "https://rmadocs.venturacounty.gov/planning/programs/california-environmental-quality-act/publications/ventura-county-initial-study-assessment-guidelines.pdf",
      phase: "environmental",
      kind: "guidelines",
      authority: "Ventura County RMA Planning Division",
      whatFor:
        "The significance thresholds and methodology the Initial Study must address.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "2025 CEQA Implementation Manual",
      url: "https://rmadocs.venturacounty.gov/planning/programs/california-environmental-quality-act/publications/ventura-county-california-environmental-quality-act-implementation-manual.pdf",
      phase: "environmental",
      kind: "guidelines",
      authority: "Ventura County RMA Planning Division",
      whatFor:
        "County CEQA procedures — noticing, filing, agency responsibilities (applies to projects deemed complete on/after Jan 1, 2026).",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },

    // ---- Building & Safety -----------------------------------------------
    {
      title: "Solar Photovoltaic (PV) Systems — permit requirements",
      url: "https://rmadocs.venturacounty.gov/building-and-safety/permit-application-information/building-and-safety-solar-photovoltaic-systems.pdf",
      phase: "building",
      kind: "checklist",
      authority: "Ventura County Building & Safety Division",
      whatFor:
        "Building & Safety's plan-check submittal requirements for the PV system permit.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "Permit Application Information and Handouts",
      url: "https://rma.venturacounty.gov/divisions/building-and-safety/permit-application-information-and-handouts/",
      phase: "building",
      kind: "page",
      authority: "Ventura County Building & Safety Division",
      whatFor:
        "Building permit applications and handouts; filing runs through VC Citizen Access.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },

    // ---- Fire -------------------------------------------------------------
    {
      title: "Form 610 — Fire Permit Application",
      url: "https://s48417.pcdn.co/wp-content/uploads/2020/12/610-Fire-Permit-Application.pdf",
      phase: "fire",
      kind: "form",
      authority: "Ventura County Fire Department — Fire Prevention Bureau",
      whatFor:
        "The fire permit application required for new structures and fire-protection-system submittals — BESS plans go in on Form 610.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "Form 625 — Fire Flow Verification",
      url: "https://s48417.pcdn.co/wp-content/uploads/2020/12/625-Fire-Flow-Verification-Form.pdf",
      phase: "fire",
      kind: "form",
      authority: "Ventura County Fire Department — Fire Prevention Bureau",
      whatFor: "Fire-flow certification required for all new structures.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "Submit Plans for Review — Fire Prevention Bureau",
      url: "https://fire.venturacounty.gov/fire-prevention/",
      phase: "fire",
      kind: "page",
      authority: "Ventura County Fire Department — Fire Prevention Bureau",
      whatFor:
        "Fire plan-check submittal instructions — construction documents plus Form 610 to the Fire Prevention Bureau.",
      verifiedAt: "2026-08-25",
      verifyStatus: "bot-blocked",
      verifyNote: "403 to scripted fetch (WAF bot-blocking); loads in browsers",
    },
    {
      title: "Fire Prevention Applications & Forms",
      url: "https://fire.venturacounty.gov/fire-prevention-applications-forms/",
      phase: "fire",
      kind: "page",
      authority: "Ventura County Fire Department — Fire Prevention Bureau",
      whatFor:
        "The full VCFD forms catalog (610 permit, 611 inspection, 612 transmittal, 618 access, 625 fire flow, 645 wildfire affidavit).",
      verifiedAt: "2026-08-25",
      verifyStatus: "bot-blocked",
      verifyNote: "403 to scripted fetch (WAF bot-blocking); loads in browsers",
    },
    {
      title: "VCFD Standards & Guidelines",
      url: "https://fire.venturacounty.gov/standards-guidelines/",
      phase: "fire",
      kind: "guidelines",
      authority: "Ventura County Fire Department",
      whatFor:
        "VCFD's adopted standards and administrative rulings that plan check is reviewed against.",
      verifiedAt: "2026-08-25",
      verifyStatus: "bot-blocked",
      verifyNote: "403 to scripted fetch (WAF bot-blocking); loads in browsers",
    },

    // ---- Interconnection (SCE) -------------------------------------------
    {
      title: "Grid Interconnection Processing Tool (GIPT) — application portal",
      url: "https://gridinterconnection.sce.com/prweb?AppName=GIPT",
      phase: "interconnection",
      kind: "portal",
      authority: "Southern California Edison",
      whatFor:
        "SCE's live portal where WDAT Interconnection Requests, Rule 21 Export/Non-Export, and Pre-Application Reports are actually filed.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "GIPT — filing instructions and user guides",
      url: "https://www.sce.com/business/smart-energy-solar/solar-for-business/grid-interconnections/grid-interconnection-processing-tool-gipt",
      phase: "interconnection",
      kind: "page",
      authority: "Southern California Edison",
      whatFor:
        "Official SCE instructions for submitting interconnection requests through GIPT.",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
    {
      title: "Wholesale Distribution Access Tariff (WDAT)",
      url: "https://www.sce.com/business/smart-energy-solar/solar-for-business/grid-interconnections/wholesale-distribution-access-tariff",
      phase: "interconnection",
      kind: "page",
      authority: "Southern California Edison",
      whatFor:
        "The FERC-jurisdictional interconnection path for a wholesale/merchant solar+BESS project (processed under the Resource Interconnection Procedures, Attachment M).",
      verifiedAt: "2026-08-25",
      verifyStatus: "ok",
    },
  ],
  notes: {
    environmental:
      "CEQA is not a separate application — review starts when the entitlement application is filed; the Initial Study template above is the working document.",
    building:
      "No county BESS-specific building plan-check handout is published — contact the county planner; the battery scope is submitted with the building permit package.",
    fire: "VCFD publishes no BESS/NFPA 855-specific standard — no public form; BESS plans are submitted on Form 610 and reviewed against CA Fire Code Ch. 12 / NFPA 855 directly. Submittals go to fireprevention@venturacounty.gov.",
  },
};
