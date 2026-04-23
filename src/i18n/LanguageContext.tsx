import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LANGUAGE_STORAGE_KEY, type LanguageCode, t as tHelper, translateTextValue } from "./translations";

// Enabled by default to guarantee full-page EN/AR coverage.
// Set VITE_I18N_DOM_TRANSLATE=false to disable if performance tuning is needed.
const ENABLE_DOM_AUTO_TRANSLATION = import.meta.env.VITE_I18N_DOM_TRANSLATE !== "false";

type LanguageContextValue = {
  language: LanguageCode;
  setLanguage: (next: LanguageCode) => void;
  toggleLanguage: () => void;
  t: (englishText: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function applyLanguageToDocument(language: LanguageCode) {
  if (typeof document === "undefined") return;

  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // ignore storage access issues
  }

  document.documentElement.lang = language;
  document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  document.body.classList.toggle("lang-ar", language === "ar");
  document.body.classList.toggle("lang-en", language === "en");
}

function getInitialLanguage(): LanguageCode {
  if (typeof window === "undefined") return "en";
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "ar") return stored;
  } catch {
    // ignore storage access issues and default to English
  }
  return "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<LanguageCode>(getInitialLanguage);
  const applyingRef = useRef(false);
  const originalTextRef = useRef(new WeakMap<Text, string>());
  const originalAttrRef = useRef(new WeakMap<Element, Map<string, string>>());

  useEffect(() => {
    applyLanguageToDocument(language);
  }, [language]);

  useEffect(() => {
    if (!ENABLE_DOM_AUTO_TRANSLATION) return;

    const root = document.getElementById("root");
    if (!root) return;

    const shouldSkipTextNode = (textNode: Text) => {
      const parent = textNode.parentElement;
      if (!parent) return true;
      const tag = parent.tagName;
      return (
        tag === "SCRIPT" ||
        tag === "STYLE" ||
        tag === "CODE" ||
        tag === "PRE" ||
        parent.closest("[data-no-translate='true']") !== null ||
        parent.closest("[translate='no']") !== null ||
        parent.closest(".notranslate") !== null
      );
    };

    const translateTextNode = (textNode: Text) => {
      if (shouldSkipTextNode(textNode)) return;

      const raw = textNode.nodeValue ?? "";
      if (!raw.trim()) return;

      let original = originalTextRef.current.get(textNode);
      if (!original) {
        original = raw;
        originalTextRef.current.set(textNode, original);
      } else {
        const currentlyExpected = translateTextValue(original, language);
        if (raw !== currentlyExpected) {
          // React or another source updated this node; reset baseline.
          original = raw;
          originalTextRef.current.set(textNode, original);
        }
      }

      const translated = translateTextValue(original, language);
      if (translated !== raw) {
        textNode.nodeValue = translated;
      }
    };

    const translateElementAttrs = (element: Element) => {
      const attrNames = ["placeholder", "title", "aria-label", "value"];
      let originalMap = originalAttrRef.current.get(element);
      if (!originalMap) {
        originalMap = new Map<string, string>();
        originalAttrRef.current.set(element, originalMap);
      }

      for (const attrName of attrNames) {
        const current = element.getAttribute(attrName);
        if (!current) continue;

        if (attrName === "value" && !(element instanceof HTMLInputElement)) continue;
        if (
          attrName === "value" &&
          element instanceof HTMLInputElement &&
          element.type !== "button" &&
          element.type !== "submit"
        ) {
          continue;
        }

        let original = originalMap.get(attrName);
        if (!original) {
          original = current;
          originalMap.set(attrName, original);
        } else {
          const currentlyExpected = translateTextValue(original, language);
          if (current !== currentlyExpected) {
            // Attribute value changed externally; reset baseline.
            original = current;
            originalMap.set(attrName, original);
          }
        }

        const translated = translateTextValue(original, language);
        if (translated !== current) {
          element.setAttribute(attrName, translated);
        }
      }
    };

    const translateSubtree = (subtreeRoot: ParentNode) => {
      const walker = document.createTreeWalker(subtreeRoot, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        translateTextNode(node as Text);
        node = walker.nextNode();
      }

      const rootEl = subtreeRoot as Element;
      if (typeof rootEl.querySelectorAll === "function") {
        const elements = rootEl.querySelectorAll(
          "[placeholder], [title], [aria-label], input[type='button'], input[type='submit']"
        );
        elements.forEach((el) => translateElementAttrs(el));
      }
    };

    applyingRef.current = true;
    try {
      translateSubtree(root);
    } finally {
      applyingRef.current = false;
    }

    const observer = new MutationObserver((mutations) => {
      if (applyingRef.current) return;
      applyingRef.current = true;

      try {
        for (const mutation of mutations) {
          if (mutation.type === "characterData") {
            translateTextNode(mutation.target as Text);
            continue;
          }

          if (mutation.type === "attributes") {
            const target = mutation.target as Element;
            translateElementAttrs(target);
            continue;
          }

          mutation.addedNodes.forEach((added) => {
            if (added.nodeType === Node.TEXT_NODE) {
              translateTextNode(added as Text);
              return;
            }

            if (added.nodeType === Node.ELEMENT_NODE) {
              translateSubtree(added as Element);
            }
          });
        }
      } finally {
        applyingRef.current = false;
      }
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
  if (!ctx) {
    const language = getInitialLanguage();
    console.error("[i18n] LanguageProvider missing, using fallback language context.");
    return {
      language,
      setLanguage: (next: LanguageCode) => applyLanguageToDocument(next),
      toggleLanguage: () => applyLanguageToDocument(language === "en" ? "ar" : "en"),
      t: (englishText: string) => tHelper(getInitialLanguage(), englishText),
    };
  }
  return ctx;
}
