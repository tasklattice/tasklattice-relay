import {
  createInstance,
  type InitOptions,
  type i18n,
} from "i18next";
import { initReactI18next } from "react-i18next";
import {
  defaultLanguage,
  supportedLanguages,
  type SupportedLanguage,
} from "./config";
import { i18nResources } from "./resources";

function platformI18nOptions(language: SupportedLanguage): InitOptions {
  return {
    defaultNS: "common",
    fallbackLng: defaultLanguage,
    initAsync: false,
    interpolation: { escapeValue: false },
    lng: language,
    ns: [
      "common",
      "login",
      "sidebar",
      "createInstance",
      "breadcrumbs",
      "help",
      "skills",
    ],
    resources: i18nResources,
    returnNull: false,
    supportedLngs: [...supportedLanguages],
  };
}

export function createPlatformI18n(language: SupportedLanguage): i18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    ...platformI18nOptions(language),
    react: { useSuspense: false },
  });
  return instance;
}
