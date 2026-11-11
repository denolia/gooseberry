import type { TranslationValues } from "next-intl";
import type en from "../../messages/en.json";

type Catalog = typeof en;
export type MessageKey = {
  [
    Namespace in keyof Catalog
  ]: `${Namespace & string}.${keyof Catalog[Namespace] & string}`;
}[keyof Catalog];
export type Translate = (key: MessageKey, values?: TranslationValues) => string;
export type MessageValues = Record<string, string | number>;
export type UiMessage = { key: MessageKey; values?: MessageValues };
export type ErrorMessageKey = Extract<MessageKey, `errors.${string}`>;
