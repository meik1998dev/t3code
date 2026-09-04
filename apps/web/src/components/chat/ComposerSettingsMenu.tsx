import { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { memo, type ReactNode } from "react";
import {
  LockIcon,
  LockOpenIcon,
  PenLineIcon,
  SparklesIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "~/lib/utils";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";
import { composerFloatingLayerProps } from "./composerEventScope";
import { useComposerMenuState } from "./useComposerMenuState";

export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: LucideIcon }
> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

/**
 * One composer pill that holds the model traits (effort, context window, fast
 * mode) and the runtime access mode. The trigger reads "Medium · 1M 🔓"; the
 * menu lists traits first, then access. In the compact footer the Plan/Build
 * toggle also folds in here as a "Mode" section.
 */
export const ComposerSettingsMenu = memo(function ComposerSettingsMenu(props: {
  provider: string;
  interactionMode: ProviderInteractionMode;
  runtimeMode: RuntimeMode;
  showInteractionModeToggle: boolean;
  traitsMenuContent?: ReactNode;
  traitsTriggerDisplay: { label: string; showFastModeIcon: boolean } | null;
  size?: ComposerControlSize;
  /**
   * The resting strip keeps this pill mounted out of flow while it does not
   * fit. Its portaled popup would outlive that transition, so an open menu
   * closes when its trigger hides.
   */
  hidden?: boolean;
  onToggleInteractionMode: () => void;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const size = props.size ?? "sm";
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const runtimeModeOption = runtimeModeConfig[props.runtimeMode];
  const traits = props.traitsTriggerDisplay;
  const tooltip = traits
    ? `${traits.label} · ${runtimeModeOption.label} — ${runtimeModeOption.description}`
    : `${runtimeModeOption.label} — ${runtimeModeOption.description}`;

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <MenuTrigger
          render={
            <TooltipTrigger
              render={
                <ComposerControl
                  size={size}
                  className={cn(
                    "shrink-0 whitespace-nowrap",
                    size === "xs" ? undefined : "font-medium",
                  )}
                  aria-label={`Model settings: ${tooltip}`}
                />
              }
            />
          }
        >
          {traits?.showFastModeIcon ? (
            <ComposerControlIcon
              icon={ZapIcon}
              size={size}
              className={cn(
                "fill-current opacity-80",
                props.provider === "claudeAgent" ? "text-[#d97757]" : "text-foreground",
              )}
            />
          ) : null}
          {traits ? <span>{traits.label}</span> : null}
          {traits ? null : <span>{runtimeModeOption.label}</span>}
        </MenuTrigger>
        <TooltipPopup side="top">{tooltip}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="start" {...composerFloatingLayerProps}>
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuSeparator />
          </>
        ) : null}
        {props.showInteractionModeToggle ? (
          <>
            <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Mode</div>
            <MenuRadioGroup
              value={props.interactionMode}
              onValueChange={(value) => {
                if (!value || value === props.interactionMode) return;
                props.onToggleInteractionMode();
              }}
            >
              <MenuRadioItem value="default">Chat</MenuRadioItem>
              <MenuRadioItem value="plan">Plan</MenuRadioItem>
            </MenuRadioGroup>
            <MenuSeparator />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Access</div>
        <MenuRadioGroup
          value={props.runtimeMode}
          onValueChange={(value) => {
            if (!value || value === props.runtimeMode) return;
            props.onRuntimeModeChange(value as RuntimeMode);
          }}
        >
          {runtimeModeOptions.map((mode) => {
            const option = runtimeModeConfig[mode];
            const OptionIcon = option.icon;
            return (
              <MenuRadioItem key={mode} value={mode} className="min-w-64 py-2">
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <OptionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    {option.label}
                  </span>
                  <span className="text-muted-foreground text-xs leading-4">
                    {option.description}
                  </span>
                </div>
              </MenuRadioItem>
            );
          })}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
});
