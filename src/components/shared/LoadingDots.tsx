export function LoadingDots() {
  return (
    <span className="inline-flex items-center gap-[3px] ml-0.5">
      {[0, 150, 300].map(delay => (
        <span
          key={delay}
          className="block w-1 h-1 rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${delay}ms`, animationDuration: '0.8s' }}
        />
      ))}
    </span>
  )
}
