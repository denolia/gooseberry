declare module "anki-apkg-export" {
  interface CardOptions {
    guid?: string;
    tags?: string[];
  }

  class AnkiExport {
    constructor(deckName: string);
    addCard(front: string, back: string, options?: CardOptions): void;
    addMedia(filename: string, data: Buffer | Uint8Array): void;
    save(): Promise<ArrayBuffer>;
  }

  export default AnkiExport;
}