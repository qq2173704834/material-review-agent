import type { ReactElement } from "react";

/** Decorative study objects; no dates, scores or progress are presented as user data. */
export function StudyIllustration(): ReactElement {
  return (
    <svg viewBox="0 0 420 300" fill="none" className="study-illustration" aria-hidden="true">
      <ellipse cx="220" cy="263" rx="151" ry="17" fill="#372586" opacity=".09" />
      <circle cx="223" cy="141" r="113" fill="#E5DFFF" />
      <circle cx="223" cy="141" r="138" stroke="#C9BFFD" strokeDasharray="4 10" />
      <g transform="rotate(-9 167 174)">
        <rect x="72" y="86" width="181" height="163" rx="17" fill="#5947C8" />
        <rect x="80" y="78" width="181" height="163" rx="17" fill="white" />
        <path d="M80 95Q80 78 97 78H244Q261 78 261 95V120H80Z" fill="#7462E3" />
        <path d="M118 67V91M221 67V91" stroke="#382B88" strokeWidth="9" strokeLinecap="round" />
        {[0, 1, 2].map((row) =>
          [0, 1, 2, 3].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={104 + col * 35}
              y={137 + row * 29}
              width="20"
              height="15"
              rx="4"
              fill={row === 1 && col === 2 ? "#C6BDF5" : "#EEEBFA"}
            />
          )),
        )}
        <rect x="163" y="153" width="39" height="39" rx="12" fill="#5341C0" />
        <path
          d="m173 172 7 7 13-15"
          stroke="white"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <g transform="rotate(10 286 218)">
        <rect x="228" y="192" width="139" height="26" rx="6" fill="#9AD8D2" />
        <path d="M241 200H358M241 208H358" stroke="#D9F4EF" strokeWidth="3" />
        <rect x="213" y="218" width="139" height="29" rx="6" fill="#F5BF82" />
        <path d="M227 226H344M227 238H344" stroke="#FFDFB8" strokeWidth="3" />
      </g>
      <g transform="rotate(15 310 119)">
        <rect x="268" y="60" width="80" height="97" rx="13" fill="white" />
        <rect x="281" y="74" width="29" height="6" rx="3" fill="#BEB3ED" />
        <path
          d="M282 96H333M282 108H323M282 120H333M282 132H313"
          stroke="#E3DDF7"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <circle cx="337" cy="145" r="22" fill="#68B8A9" />
        <path
          d="m327 145 7 7 13-15"
          stroke="white"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      <path d="m53 122 5-13 5 13 13 5-13 5-5 13-5-13-13-5Z" fill="#D7A756" />
      <path d="m357 37 3-8 3 8 8 3-8 3-3 8-3-8-8-3Z" fill="#A194E7" />
      <circle cx="69" cy="219" r="6" fill="#8BC7CB" />
      <circle cx="353" cy="192" r="5" fill="#C6BDF5" />
    </svg>
  );
}
