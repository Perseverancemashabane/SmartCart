import { redirect } from 'next/navigation';

// Root page redirects to the static index.html in /public
export default function Home() {
  redirect('/index.html');
}

