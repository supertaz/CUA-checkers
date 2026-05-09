import './globals.css';

export const metadata = {
  title: 'CUA Checkers',
  description: 'Browser-based 2D checkers for Computer Use Agents',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
