const STEPS = [
  ["1", "Buy", "Buy any token on its curve. Your hold clock starts the moment you do."],
  ["2", "Hold", "Your sell tax melts toward zero the longer you hold. Tokens stay on the curve, so nobody can dump around the rules."],
  ["3", "Get paid", "Early sellers pay a tax and part of it goes straight to the holders who stayed. Claim whenever you like."],
] as const;

export default function HowItWorks() {
  return (
    <section className="how" aria-labelledby="how-h">
      <h2 id="how-h" className="how-h">
        How it works
      </h2>
      <ol className="how-grid">
        {STEPS.map(([n, title, text]) => (
          <li key={n}>
            <span className="how-n">{n}</span>
            <h3>{title}</h3>
            <p>{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
