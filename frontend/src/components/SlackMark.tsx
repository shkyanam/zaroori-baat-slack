export default function SlackMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#36C5F0"
        d="M9 0a2.5 2.5 0 0 0 0 5h2.5V2.5A2.5 2.5 0 0 0 9 0ZM2.5 6.5a2.5 2.5 0 0 0 0 5H9a2.5 2.5 0 0 0 0-5H2.5Z"
      />
      <path
        fill="#2EB67D"
        d="M24 9a2.5 2.5 0 0 0-5 0v2.5h2.5A2.5 2.5 0 0 0 24 9ZM17.5 2.5a2.5 2.5 0 0 0-5 0V9a2.5 2.5 0 0 0 5 0V2.5Z"
      />
      <path
        fill="#ECB22E"
        d="M15 24a2.5 2.5 0 0 0 0-5h-2.5v2.5A2.5 2.5 0 0 0 15 24ZM21.5 17.5a2.5 2.5 0 0 0 0-5H15a2.5 2.5 0 0 0 0 5h6.5Z"
      />
      <path
        fill="#E01E5A"
        d="M0 15a2.5 2.5 0 0 0 5 0v-2.5H2.5A2.5 2.5 0 0 0 0 15ZM6.5 21.5a2.5 2.5 0 0 0 5 0V15a2.5 2.5 0 0 0-5 0v6.5Z"
      />
    </svg>
  );
}
