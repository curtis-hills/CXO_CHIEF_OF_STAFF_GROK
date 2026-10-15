import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="font-serif text-3xl">That page isn’t here</h1>
      <Link href="/" className="mt-4 inline-block text-sm text-tide">
        Back to the daily brief
      </Link>
    </main>
  );
}
