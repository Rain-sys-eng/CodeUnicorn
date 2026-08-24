import type { CSSProperties } from "react";
import {
  DEFAULT_AGENT_ICON,
  getAgentIconSvgMarkup,
  isCodiconAgentIcon,
  resolveAgentIcon,
  resolveAgentIconBySeed,
  type AgentIconClass,
} from "../utils/agentIcons";

type AgentIconProps = {
  icon?: unknown;
  seed?: unknown;
  fallback?: AgentIconClass;
  className?: string;
  size?: number;
  title?: string;
  ariaHidden?: boolean;
};

function joinClassName(...parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" ");
}

export function AgentIcon({
  icon,
  seed,
  fallback = DEFAULT_AGENT_ICON,
  className,
  size = 16,
  title,
  ariaHidden = true,
}: AgentIconProps) {
  const resolved =
    seed === undefined
      ? resolveAgentIcon(icon, fallback)
      : resolveAgentIconBySeed(icon, seed, fallback);

  if (isCodiconAgentIcon(resolved)) {
    return (
      <span
        className={joinClassName("codicon", resolved, className)}
        aria-hidden={ariaHidden}
        title={title}
        style={{ fontSize: size, lineHeight: 1 } as CSSProperties}
      />
    );
  }

  const svgMarkup = getAgentIconSvgMarkup(resolved);
  return (
    <span
      className={joinClassName("agent-icon-svg", className)}
      aria-hidden={ariaHidden}
      title={title}
      style={
        {
          width: size,
          height: size,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        } as CSSProperties
      }
      dangerouslySetInnerHTML={{ __html: svgMarkup ?? "" }}
    />
  );
}
