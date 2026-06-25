import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Settings, RefreshCw, Trash2, Languages, ChevronDown, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CRTBackground } from './CRTBackground';
import { changeLanguage, languageNames, supportedLanguages, type SupportedLanguage } from '@/i18n';

interface OptionsScreenProps {
  onBack: () => void;
  onReEnableTutorials: () => void;
  onResetCertificates: () => void;
  hasCertificates: boolean;
  accentColor?: string;
}

export function OptionsScreen({
  onBack,
  onReEnableTutorials,
  onResetCertificates,
  hasCertificates,
  accentColor,
}: OptionsScreenProps) {
  const { t, i18n } = useTranslation();
  const [showConfirm, setShowConfirm] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  const resolved = i18n.resolvedLanguage ?? i18n.language;
  const activeLanguage: SupportedLanguage = (supportedLanguages as readonly string[]).includes(resolved)
    ? (resolved as SupportedLanguage)
    : 'en';

  // Close the language dropdown when tapping/clicking outside it.
  useEffect(() => {
    if (!langOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [langOpen]);

  const handleSelectLanguage = (lang: SupportedLanguage) => {
    changeLanguage(lang);
    setLangOpen(false);
  };

  const handleResetClick = () => {
    setShowConfirm(true);
  };

  const handleConfirmReset = () => {
    onResetCertificates();
    setShowConfirm(false);
  };

  const handleCancelReset = () => {
    setShowConfirm(false);
  };

  return (
    <>
      <CRTBackground accentColor={accentColor} />
      <div className="min-h-screen flex flex-col items-center justify-center bg-background/90 p-6 relative z-10">
      {/* Background effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute w-64 h-64 rounded-full bg-primary/5 blur-3xl"
          animate={{
            x: [0, 80, 0],
            y: [0, -40, 0],
          }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          style={{ top: '30%', left: '15%' }}
        />
        <motion.div
          className="absolute w-80 h-80 rounded-full bg-accent/5 blur-3xl"
          animate={{
            x: [0, -60, 0],
            y: [0, 50, 0],
          }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
          style={{ bottom: '20%', right: '10%' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 flex flex-col items-center gap-8 w-full max-w-sm"
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <Settings className="w-8 h-8 text-primary" />
          <h1 className="text-3xl sm:text-4xl font-display font-black tracking-wider text-foreground">
            {t('options.title')}
          </h1>
        </div>

        {/* Options List */}
        <motion.div
          className="flex flex-col gap-4 w-full"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          {/* Language selector */}
          <div className="w-full" ref={langRef}>
            <div className="flex items-center gap-2 mb-2 text-sm font-display tracking-wide text-muted-foreground">
              <Languages className="w-4 h-4" />
              {t('options.language')}
            </div>
            <div className="relative">
              <motion.button
                className="w-full flex items-center justify-between gap-3 rounded-lg px-4 py-3 bg-card/60 border-2 border-primary/40 hover:border-primary text-foreground font-display tracking-wide transition-colors"
                onClick={() => setLangOpen((o) => !o)}
                whileTap={{ scale: 0.98 }}
                aria-haspopup="listbox"
                aria-expanded={langOpen}
              >
                <span>{languageNames[activeLanguage]}</span>
                <ChevronDown
                  className={`w-5 h-5 text-primary transition-transform duration-200 ${langOpen ? 'rotate-180' : ''}`}
                />
              </motion.button>

              <AnimatePresence>
                {langOpen && (
                  <motion.ul
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                    role="listbox"
                    className="absolute left-0 right-0 top-full mt-2 z-50 rounded-lg overflow-hidden border-2 border-primary/40 bg-card shadow-xl shadow-primary/10"
                  >
                    {supportedLanguages.map((lang) => {
                      const isActive = activeLanguage === lang;
                      return (
                        <li key={lang} role="option" aria-selected={isActive}>
                          <button
                            className={`w-full flex items-center justify-between gap-3 px-4 py-3 text-left font-display tracking-wide transition-colors ${
                              isActive
                                ? 'bg-primary/15 text-primary'
                                : 'text-foreground hover:bg-primary/10'
                            }`}
                            onClick={() => handleSelectLanguage(lang)}
                          >
                            <span>{languageNames[lang]}</span>
                            {isActive && <Check className="w-4 h-4 text-primary" />}
                          </button>
                        </li>
                      );
                    })}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Re-enable All Tutorials */}
          <motion.button
            className="arcade-button-primary rounded-lg flex items-center justify-center gap-2"
            onClick={onReEnableTutorials}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <RefreshCw className="w-5 h-5" />
            {t('options.reEnableTutorials')}
          </motion.button>

          {/* Reset certificates */}
          {hasCertificates && (
            <motion.button
              className="arcade-button-danger rounded-lg flex items-center justify-center gap-2"
              onClick={handleResetClick}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Trash2 className="w-5 h-5" />
              {t('options.resetCertificates')}
            </motion.button>
          )}

          {/* Back Button */}
          <motion.button
            className="arcade-button-secondary rounded-lg flex items-center justify-center gap-2 mt-4"
            onClick={onBack}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <ArrowLeft className="w-5 h-5" />
            {t('options.back')}
          </motion.button>
        </motion.div>
      </motion.div>

      {/* Confirmation Dialog */}
      {showConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border rounded-xl p-6 max-w-sm w-full shadow-xl"
          >
            <h2 className="text-xl font-display font-bold text-foreground mb-4">
              {t('options.resetConfirmTitle')}
            </h2>
            <p className="text-muted-foreground mb-6">
              {t('options.resetConfirmBody')}
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 arcade-button-secondary rounded-lg py-2"
                onClick={handleCancelReset}
              >
                {t('options.cancel')}
              </button>
              <button
                className="flex-1 arcade-button-danger rounded-lg py-2"
                onClick={handleConfirmReset}
              >
                {t('options.reset')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
    </>
  );
}
