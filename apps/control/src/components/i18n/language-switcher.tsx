import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { applyPlatformLanguage } from "@/lib/platform-preferences";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  defaultLanguage,
  normalizeLanguage,
  type SupportedLanguage,
} from "@/i18n/config";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({
  className,
  compactOnMobile = false,
  size = "lg",
}: {
  className?: string;
  compactOnMobile?: boolean;
  size?: "default" | "lg";
}) {
  const { i18n, t } = useTranslation("common");
  const language =
    normalizeLanguage(i18n.resolvedLanguage ?? i18n.language) ??
    defaultLanguage;

  return (
    <Select
      value={language}
      onValueChange={(value) =>
        applyPlatformLanguage(value as SupportedLanguage)
      }
    >
      <SelectTrigger
        aria-label={t("language.label")}
        size={size}
        className={cn(
          "min-w-36 bg-background/90",
          compactOnMobile
            ? "min-w-11 justify-center px-0 [&_[data-slot=select-value]]:hidden [&>svg:last-child]:hidden sm:min-w-36 sm:justify-between sm:px-3 sm:[&_[data-slot=select-value]]:flex sm:[&>svg:last-child]:block"
            : null,
          className,
        )}
      >
        <Languages className="size-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="en-US">{t("language.english")}</SelectItem>
        <SelectItem value="zh-CN">{t("language.simplifiedChinese")}</SelectItem>
        <SelectItem value="zh-TW">{t("language.traditionalChinese")}</SelectItem>
      </SelectContent>
    </Select>
  );
}
