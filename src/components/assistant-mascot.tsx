import type { ReactElement } from "react";

/** Original project artwork, shared by the launcher and conversation header. */
export function AssistantMascot({ thinking = false }: { thinking?: boolean }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="48"
      height="48"
      viewBox="0 0 80 80"
      className={`assistant-mascot shrink-0 ${thinking ? "is-thinking" : ""}`}
    >
      <ellipse cx="39" cy="73" rx="24" ry="3" fill="#0f766e" opacity=".12" />
      <g className="mascot-body">
        <path
          className="mascot-tail"
          d="M60 51Q69 37 76 40Q79 48 70 52Q79 59 73 65Q64 65 60 58"
          fill="#38b4c2"
          stroke="#17546e"
          strokeWidth="2"
        />
        <path
          d="M12 43C12 23 27 16 40 19C55 19 65 32 65 47C66 63 53 69 36 67C19 66 9 58 12 43Z"
          fill="#64c9d9"
          stroke="#17546e"
          strokeWidth="2"
        />
        <path d="M17 48Q37 58 61 48Q61 64 38 64Q20 63 17 48" fill="#e5fbff" />
        <path
          d="M20 25L23 16L29 18L33 12L39 16L46 12L50 19L57 18L59 28Q39 20 20 25Z"
          fill="#fff"
          stroke="#17546e"
          strokeWidth="1.7"
        />
        <path d="M28 23Q40 19 51 24" fill="none" stroke="#17546e" strokeWidth="3" />
        <g className="mascot-eyes" fill="#154964">
          <ellipse cx="28" cy="39" rx="3" ry="4" />
          <ellipse cx="49" cy="39" rx="3" ry="4" />
        </g>
        <circle cx="22" cy="46" r="4" fill="#f9a8bf" opacity=".65" />
        <circle cx="55" cy="46" r="4" fill="#f9a8bf" opacity=".65" />
        <path
          d="M34 46Q39 51 44 46"
          fill="none"
          stroke="#17546e"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M20 52Q13 48 10 54Q13 60 23 58"
          fill="#38b4c2"
          stroke="#17546e"
          strokeWidth="1.6"
        />
        <path d="M35 57L28 53L29 63L36 60L43 64L46 54L38 57" fill="#17546e" />
        <circle cx="37" cy="58" r="2.6" fill="#f5faff" />
      </g>
      <g className="mascot-bubbles" fill="#38b4c2">
        <circle cx="68" cy="22" r="3" />
        <circle cx="62" cy="13" r="2" />
      </g>
    </svg>
  );
}
