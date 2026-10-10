export const STUDY_CARD_TEMPLATE_KEYS = [
  "recognition",
  "production",
  "word_forms",
  "type_answer",
  "example",
] as const;

export type StudyCardTemplateKey = (typeof STUDY_CARD_TEMPLATE_KEYS)[number];

export type StudyCardContent = {
  original: string;
  translation: string;
  wordForms: string;
  sample: string;
  sampleTranslation: string;
};

export type StudyCardContentField = keyof StudyCardContent;

export type StudyCardTemplate = {
  key: StudyCardTemplateKey;
  label: string;
  promptField: StudyCardContentField;
  answerField: StudyCardContentField;
  requiredFields: readonly StudyCardContentField[];
  requiresTyping: boolean;
};

// Stable keys identify independently scheduled exercises, rather than copies of
// note content. Missing optional fields pause availability, not card identity.
export const STUDY_CARD_TEMPLATES: readonly StudyCardTemplate[] = [
  {
    key: "recognition",
    label: "Recognition",
    promptField: "original",
    answerField: "translation",
    requiredFields: ["original", "translation"],
    requiresTyping: false,
  },
  {
    key: "production",
    label: "Production",
    promptField: "translation",
    answerField: "original",
    requiredFields: ["original", "translation"],
    requiresTyping: false,
  },
  {
    key: "word_forms",
    label: "Word forms",
    promptField: "original",
    answerField: "wordForms",
    requiredFields: ["original", "wordForms"],
    requiresTyping: false,
  },
  {
    key: "type_answer",
    label: "Type the source",
    promptField: "translation",
    answerField: "original",
    requiredFields: ["original", "translation"],
    requiresTyping: true,
  },
  {
    key: "example",
    label: "Example recall",
    promptField: "sampleTranslation",
    answerField: "sample",
    requiredFields: ["sample", "sampleTranslation"],
    requiresTyping: false,
  },
];

export function isStudyCardTemplateKey(
  value: unknown,
): value is StudyCardTemplateKey {
  return STUDY_CARD_TEMPLATE_KEYS.some((key) => key === value);
}

export function getStudyCardTemplate(
  key: StudyCardTemplateKey,
): StudyCardTemplate {
  return STUDY_CARD_TEMPLATES.find((template) => template.key === key)!;
}

export function isStudyCardApplicable(
  key: StudyCardTemplateKey,
  content: StudyCardContent,
): boolean {
  return getStudyCardTemplate(key).requiredFields.every(
    (field) => content[field].trim().length > 0,
  );
}

export function getApplicableStudyCardTemplateKeys(
  content: StudyCardContent,
): StudyCardTemplateKey[] {
  return STUDY_CARD_TEMPLATE_KEYS.filter((key) =>
    isStudyCardApplicable(key, content),
  );
}
