import type { ReactNode } from 'react';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  frost = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  frost?: boolean;
}) {
  const base =
    'rounded-2xl border shadow-lg border-white/10 ' +
    (frost ? 'bg-white/5 backdrop-blur-sm ' : 'bg-white/5 ');
  return (
    <section className={base + className}>
      {(title || subtitle || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-5">
          <div>
            {typeof title === 'string' ? <h2 className="text-lg font-semibold">{title}</h2> : title}
            {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={
        'rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50 ' +
        (props.className ?? '')
      }
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={
        'w-full rounded-lg border border-white/15 bg-black/10 px-3 py-2 outline-none ' +
        'placeholder:text-gray-500 focus:border-white/30 ' +
        (props.className ?? '')
      }
    />
  );
}
