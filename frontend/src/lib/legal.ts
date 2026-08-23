/**
 * Legal consent layer — shared content for the first-visit ConsentGate modal
 * and the /legal page. Acceptance is persisted in localStorage under
 * CONSENT_STORAGE_KEY ("rai.legal.v1") as { accepted: true, date: ISO }.
 *
 * Template pending counsel review.
 */

export const CONSENT_STORAGE_KEY = "rai.legal.v1";

export interface LegalSection {
  id: string;
  title: string;
  body: string[];
}

export const LEGAL_SECTIONS: LegalSection[] = [
  {
    id: "ai-output",
    title: "AI output — not professional advice",
    body: [
      "Everything RAI produces — summaries, scores, findings, and reports — is AI-generated preliminary research, provided for informational purposes only.",
      "It is not engineering, legal, environmental, or financial advice, and using RAI does not create any professional-client relationship.",
      "Verify every output against county records and with licensed professionals before acting on it.",
    ],
  },
  {
    id: "accuracy",
    title: "Accuracy of data & scores",
    body: [
      "Data shown in RAI may be incomplete, outdated, or wrong. Source records change, and coverage varies by county.",
      "Readiness and activation scores are heuristics, not guarantees of project outcomes.",
      "AI can misread documents. Treat extracted fields as leads to confirm, not facts to rely on.",
    ],
  },
  {
    id: "privacy",
    title: "Privacy & data handling",
    body: [
      "What we store: documents you upload are held on the server for the duration of a run; preferences are kept in your browser's localStorage; we collect basic usage telemetry to improve the product.",
      "We do not sell your data.",
      "To request deletion of your documents or data, contact us at the address below and we will remove them.",
    ],
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: [
      "TO THE MAXIMUM EXTENT PERMITTED BY LAW, RAI and its operators are not liable for any indirect, incidental, special, or consequential damages, including lost profits or lost opportunities, arising from your use of the app.",
      "Our total liability is capped at the amounts you paid us, or $100 if you use RAI for free.",
    ],
  },
  {
    id: "indemnification",
    title: "Indemnification",
    body: [
      "You agree to indemnify and hold harmless RAI and its operators from claims, losses, and expenses arising from your misuse of the app or violation of these terms.",
    ],
  },
  {
    id: "warranty-law",
    title: "No warranty, governing law & contact",
    body: [
      'RAI is provided "AS IS" and "AS AVAILABLE", with no warranties of any kind, express or implied.',
      "These terms are governed by the laws of the State of California.",
      "Contact: [legal contact placeholder].",
    ],
  },
];

export const LEGAL_TEMPLATE_NOTE = "template pending counsel review";
