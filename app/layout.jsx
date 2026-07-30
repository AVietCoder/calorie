import '../styles/both.css';
import '../styles/toast.css';
import '../styles/survey-prompt.css';
import { AuthProvider } from '../lib-client/AuthContext';
import { I18nProvider } from '../lib-client/I18nContext';
import { ToastProvider } from '../lib-client/ToastContext';

export const metadata = {
  title: 'Dr.Fit',
  icons: { icon: '/logo.png' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <head>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <I18nProvider>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
