import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export type ContextSettingsSectionGroup<Section extends string> = {
  label: string;
  items: readonly {
    id: Section;
    label: string;
    icon: LucideIcon;
  }[];
};

export function ContextSettingsSidebar<Section extends string>({
  ariaLabel,
  disabled = false,
  groups,
  header,
  onSectionChange,
  section,
}: {
  ariaLabel: string;
  disabled?: boolean;
  groups: readonly ContextSettingsSectionGroup<Section>[];
  header: ReactNode;
  onSectionChange: (section: Section) => void;
  section: Section;
}) {
  return (
    <>
      <SidebarHeader className="min-h-16 shrink-0 justify-center border-b border-sidebar-border px-4 py-2">
        <div className="grid min-w-0 gap-0.5 text-sidebar-foreground [&_.text-muted-foreground]:text-sidebar-foreground/55">
          {header}
        </div>
      </SidebarHeader>
      <SidebarContent className="py-3">
        <nav aria-label={ariaLabel}>
          {groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        type="button"
                        size="lg"
                        className="h-11"
                        disabled={disabled}
                        isActive={section === item.id}
                        aria-current={section === item.id ? "page" : undefined}
                        onClick={() => onSectionChange(item.id)}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
    </>
  );
}

export function ContextSettingsMobileNavigation<Section extends string>({
  ariaLabel,
  disabled = false,
  groups,
  leading,
  onSectionChange,
  section,
}: {
  ariaLabel: string;
  disabled?: boolean;
  groups: readonly ContextSettingsSectionGroup<Section>[];
  leading?: ReactNode;
  onSectionChange: (section: Section) => void;
  section: Section;
}) {
  return (
    <div className={cn("grid gap-3", leading && "sm:grid-cols-2")}>
      {leading}
      <Select
        disabled={disabled}
        value={section}
        onValueChange={(value) => onSectionChange(value as Section)}
      >
        <SelectTrigger size="lg" className="w-full" aria-label={ariaLabel}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groups.map((group) => (
            <SelectGroup key={group.label}>
              <SelectLabel>{group.label}</SelectLabel>
              {group.items.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  <item.icon />
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
