import { AnkiNote } from "@/app/utils/ankiSchema";

export async function createApkgPackage(
  deckName: string,
  notes: AnkiNote[],
  sourceLang: string = "DE",
  targetLang: string = "RU",
): Promise<Buffer> {
  // Dynamic import to avoid webpack bundling issues
  const AnkiExport = (await import("anki-apkg-export")).default;

  const apkg = new AnkiExport(deckName);

  for (const note of notes) {
    // Card 1: Origin -> Translation
    apkg.addCard(
      createCard1Front(note, sourceLang, targetLang),
      createCard1Back(note),
    );

    // Card 2: Translation -> Origin
    apkg.addCard(
      createCard2Front(note, sourceLang, targetLang),
      createCard2Back(note),
    );

    if (note.wordForms) {
      // Card 3: Origin -> Word Forms
      apkg.addCard(createCard3Front(note), createCard3Back(note));
    }
    // Card 4: Sample Translation -> Sample
    apkg.addCard(createCard4Front(note), createCard4Back(note));

    // Card 5: Input Origin (type answer)
    apkg.addCard(createCard5Front(note, sourceLang), createCard5Back(note));
  }

  const zip = await apkg.save();
  return Buffer.from(new Uint8Array(zip));
}

// Card 1: origin->translation
function createCard1Front(
  note: AnkiNote,
  sourceLang: string,
  targetLang: string,
): string {
  return `
<div style="text-align: center;">${sourceLang}->${targetLang}</div>
<div style="text-align: center;">${note.original}</div>
`;
}

function createCard1Back(note: AnkiNote): string {
  // Note: In anki-apkg, we manually render FrontSide since it's not a template variable
  const parts: string[] = [];

  parts.push(`<hr id="answer" width="100%" style="margin-left:0">`);
  parts.push(`<div style="text-align: center;">${note.translation}</div>`);

  if (note.wordForms) {
    parts.push(
      `<div style="text-align: center; margin-top: 30px;">[${note.wordForms}]</div>`,
    );
  }

  if (note.sample) {
    parts.push(
      `<div style="text-align: left; margin-top: 30px; font-style: italic">${note.sample}</div>`,
    );
  }

  if (note.sampleTranslation) {
    parts.push(
      `<div style="text-align: left; font-weight: bold">${note.sampleTranslation}</div>`,
    );
  }

  if (note.comments) {
    parts.push(`<hr id="comments" width="100%" style="margin-left:0">`);
    parts.push(`Comments: ${note.comments}`);
  }

  return parts.join("\n");
}

// Card 2: translation->origin
function createCard2Front(
  note: AnkiNote,
  sourceLang: string,
  targetLang: string,
): string {
  return `
<div id="prefix" style="text-align: center;">${targetLang}->${sourceLang}</div>
${note.translation}
`;
}

function createCard2Back(note: AnkiNote): string {
  const parts = [`<hr id="answer" width="100%" style="margin-left:0">`];
  parts.push(note.original);

  if (note.wordForms) {
    parts.push(
      `<div style="text-align: center; margin-top: 30px;">[${note.wordForms}]</div>`,
    );
  }

  if (note.sample) {
    parts.push(
      `<div style="text-align: left; margin-top: 30px; font-style: italic">${note.sample}</div>`,
    );
  }

  if (note.sampleTranslation) {
    parts.push(
      `<div style="text-align: left; font-weight: bold">${note.sampleTranslation}</div>`,
    );
  }

  if (note.comments) {
    parts.push(`<hr id="comments" width="100%" style="margin-left:0">`);
    parts.push(`Comments: ${note.comments}`);
  }

  return parts.join("\n");
}

// Card 3: Origin -> word forms
function createCard3Front(note: AnkiNote): string {
  return `
<div id="prefix" style="text-align: center;">WORD FORMS</div>
${note.original}
<div style="text-align: center; margin-top: 30px;">[${note.translation}]</div>
<hr id="answer" width="100%" style="margin-left:0">
`;
}

function createCard3Back(note: AnkiNote): string {
  const parts: string[] = [];

  if (note.wordForms) {
    parts.push(
      `<div style="text-align: center; margin-top: 30px;">[${note.wordForms}]</div>`,
    );
  }

  if (note.sample) {
    parts.push(
      `<div style="text-align: left; margin-top: 30px; font-style: italic">${note.sample}</div>`,
    );
  }

  if (note.sampleTranslation) {
    parts.push(
      `<div style="text-align: left; font-weight: bold">${note.sampleTranslation}</div>`,
    );
  }

  if (note.comments) {
    parts.push(`<hr id="comments" width="100%" style="margin-left:0">`);
    parts.push(`Comments: ${note.comments}`);
  }

  return parts.join("\n");
}

// Card 4: Sample Translation -> Sample
function createCard4Front(note: AnkiNote): string {
  return `
<div id="prefix" style="text-align: center;">SAMPLE</div>
<div style="text-align: center; margin-top: 10px;">[${note.translation}]</div>
<div style="text-align: left; margin-top: 30px; font-weight: bold">${note.sampleTranslation}</div>
<hr id="answer" width="100%" style="margin-left:0">
`;
}

function createCard4Back(note: AnkiNote): string {
  const parts = [
    `<div id="prefix" style="text-align: center;">SAMPLE</div>`,
    `<div style="text-align: center;">${note.original}</div>`,
    `<div style="text-align: center; margin-top: 0px;">[${note.translation}]</div>`,
    `<div style="text-align: left; margin-top: 30px;">${note.sampleTranslation}</div>`,
    `<hr id="answer" width="100%" style="margin-left:0">`,
  ];

  if (note.sample) {
    parts.push(`<div style="text-align: left">${note.sample}</div>`);
  }

  if (note.comments) {
    parts.push(`<hr id="comments" width="100%" style="margin-left:0">`);
    parts.push(`Comments: ${note.comments}`);
  }

  return parts.join("\n");
}

// Card 5: Input origin
function createCard5Front(note: AnkiNote, sourceLang: string): string {
  return `
<div id="prefix" style="text-align: center;">INPUT ${sourceLang}</div>
${note.translation}
<div style="margin-top: 30px;">
    <input type="text" placeholder="Type your answer...">
</div>
`;
}

function createCard5Back(note: AnkiNote): string {
  const parts = [
    note.translation,
    `<div style="margin-top: 30px;">`,
    `Answer: ${note.original}`,
    `</div>`,
    `<hr id="answer" width="100%" style="margin-left:0">`,
  ];

  if (note.wordForms) {
    parts.push(
      `<div style="text-align: center; margin-top: 30px;">[${note.wordForms}]</div>`,
    );
  }

  if (note.sample) {
    parts.push(
      `<div style="text-align: left; margin-top: 30px; font-style: italic">${note.sample}</div>`,
    );
  }

  if (note.sampleTranslation) {
    parts.push(
      `<div style="text-align: left; font-weight: bold">${note.sampleTranslation}</div>`,
    );
  }

  if (note.comments) {
    parts.push(`<hr id="comments" width="100%" style="margin-left:0">`);
    parts.push(`Comments: ${note.comments}`);
  }

  return parts.join("\n");
}
