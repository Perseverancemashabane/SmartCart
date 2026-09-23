export const metadata = {
  title: 'SmartCart IoT - Real-time Shopping System',
  description: 'IoT Smart Shopping Cart with RFID scanning and Stripe payments',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

