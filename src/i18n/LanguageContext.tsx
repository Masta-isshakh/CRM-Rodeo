import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LANGUAGE_STORAGE_KEY, type LanguageCode, t as tHelper, translateTextValue } from "./translations";

type LanguageContextValue = {
  language: LanguageCode;
  setLanguage: (next: LanguageCode) => void;
  toggleLanguage: () => void;
  t: (englishText: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function getInitialLanguage(): LanguageCode {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === "en" || stored === "ar") return stored;
  return "en";
}

function translateElementTree(root: ParentNode, language: LanguageCode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let node = walker.nextNode();
  while (node) {
    const textNode = node as Text;
    const parentTag = textNode.parentElement?.tagName;
    const shouldSkip = parentTag === "SCRIPT" || parentTag === "STYLE" || parentTag === "CODE" || parentTag === "PRE";
    if (!shouldSkip && textNode.nodeValue && textNode.nodeValue.trim()) {
      textNode.nodeValue = translateTextValue(textNode.nodeValue, language);
    }
    node = walker.nextNode();
  }

  const elements = (root as Element).querySelectorAll?.("[placeholder], [title], [aria-label], input[type='button'], input[type='submit']") ?? [];
  elements.forEach((el) => {
    const element = el as HTMLElement;
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) element.setAttribute("placeholder", translateTextValue(placeholder, language));

    const title = element.getAttribute("title");
    if (title) element.setAttribute("title", translateTextValue(title, language));

    const aria = element.getAttribute("aria-label");
    if (aria) element.setAttribute("aria-label", translateTextValue(aria, language));

    if (element instanceof HTMLInputElement && (element.type === "button" || element.type === "submit") && element.value) {
      element.value = translateTextValue(element.value, language);
    }
  });
}

function translateElementAttributes(element: Element, language: LanguageCode) {
  const attrNames = ["placeholder", "title", "aria-label", "value"];
  for (const attrName of attrNames) {
    const attrValue = element.getAttribute(attrName);
    if (!attrValue) continue;

    if (attrName === "value" && !(element instanceof HTMLInputElement)) continue;
    if (attrName === "value" && element instanceof HTMLInputElement) {
      if (element.type !== "button" && element.type !== "submit") continue;
    }

    element.setAttribute(attrName, translateTextValue(attrValue, language));
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<LanguageCode>(getInitialLanguage);
  const applyingRef = useRef(false);

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    document.body.classList.toggle("lang-ar", language === "ar");
    document.body.classList.toggle("lang-en", language === "en");
  }, [language]);

  useEffect(() => {
    const root = document.body;
    if (!root) return;

    applyingRef.current = true;
    translateElementTree(root, language);
    applyingRef.current = false;

    const observer = new MutationObserver((mutations) => {
      if (applyingRef.current) return;
      applyingRef.current = true;

      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          const textNode = mutation.target as Text;
          if (textNode.nodeValue?.trim()) {
            textNode.nodeValue = translateTextValue(textNode.nodeValue, language);
          }
          continue;
        }

        if (mutation.type === "attributes") {
          const target = mutation.target as Element;
          translateElementAttributes(target, language);
          continue;
        }

        mutation.addedNodes.forEach((added) => {
          if (added.nodeType === Node.TEXT_NODE) {
            const textNode = added as Text;
            if (textNode.nodeValue?.trim()) {
              textNode.nodeValue = translateTextValue(textNode.nodeValue, language);
            }
            return;
          }

          if (added.nodeType === Node.ELEMENT_NODE) {
            translateElementTree(added as Element, language);
          }
        });
      }

      applyingRef.current = false;
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label", "value"],
    });
    return () => observer.disconnect();
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      toggleLanguage: () => setLanguage((prev) => (prev === "en" ? "ar" : "en")),
      t: (englishText: string) => tHelper(language, englishText),
    }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside LanguageProvider");
  return ctx;
}
