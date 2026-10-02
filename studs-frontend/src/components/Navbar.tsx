import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

type NavLink = { label: string; path: string };

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 900 : false,
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Close the mobile menu whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const logout = () => {
    localStorage.clear();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;

  const homePath =
    user.role === 'ADMIN'
      ? '/admin'
      : user.role === 'RIDER'
        ? '/rider'
        : user.role === 'VENDOR'
          ? '/vendor/dashboard'
          : '/dashboard';

  const links: NavLink[] =
    user.role === 'STUDENT'
      ? [
          { label: 'Home', path: '/dashboard' },
          { label: 'Menu', path: '/menu' },
          { label: 'My Orders', path: '/orders' },
          { label: 'Wallet', path: '/wallet' },
          { label: 'Profile', path: '/profile' },
        ]
      : user.role === 'VENDOR'
        ? [
            { label: 'My Shop', path: '/vendor/dashboard' },
            { label: 'Orders', path: '/vendor/orders' },
            { label: 'Wallet', path: '/wallet' },
          ]
        : user.role === 'RIDER'
          ? [
              { label: 'Rider Hub', path: '/rider' },
              { label: 'Wallet', path: '/wallet' },
            ]
          : user.role === 'ADMIN'
            ? [{ label: 'Control Center', path: '/admin' }]
            : [];

  const go = (path: string) => {
    setMenuOpen(false);
    navigate(path);
  };

  return (
    <nav
      style={{
        background: 'rgba(5, 6, 15, 0.97)',
        backdropFilter: 'blur(16px)',
        padding: isMobile ? '14px 18px' : '18px 40px',
        borderBottom: '1px solid rgba(244, 114, 182, 0.15)',
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? '0' : '48px', minWidth: 0 }}>
          <div
            onClick={() => go(homePath)}
            style={{
              fontSize: isMobile ? '28px' : '34px',
              fontWeight: '900',
              background: 'linear-gradient(90deg, #f472b6, #fb923c, #facc15)',
              WebkitBackgroundClip: 'text',
              color: 'transparent',
              cursor: 'pointer',
              letterSpacing: '-1.5px',
              whiteSpace: 'nowrap',
            }}
          >
            STUDS
          </div>

          {!isMobile && (
            <div style={{ display: 'flex', gap: '32px' }}>
              {links.map((link) => (
                <button
                  key={link.path}
                  onClick={() => go(link.path)}
                  style={navLinkStyle(isActive(link.path))}
                >
                  {link.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {!isMobile ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
            <div style={{ color: '#e0e7ff', fontSize: '15px', textAlign: 'right' }}>
              {user.name} <br />
              <span style={{ color: '#f472b6', fontWeight: '600', fontSize: '14px' }}>{user.role}</span>
            </div>
            <button onClick={logout} style={logoutStyle}>
              Logout
            </button>
          </div>
        ) : (
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            style={{
              background: 'rgba(244, 114, 182, 0.12)',
              border: '1px solid rgba(244, 114, 182, 0.35)',
              borderRadius: '12px',
              color: '#f8fafc',
              fontSize: '22px',
              lineHeight: 1,
              padding: '10px 14px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        )}
      </div>

      {isMobile && menuOpen && (
        <div
          style={{
            marginTop: '14px',
            paddingTop: '14px',
            borderTop: '1px solid rgba(244, 114, 182, 0.15)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ color: '#e0e7ff', fontSize: '15px', padding: '2px 4px 8px' }}>
            {user.name}{' '}
            <span style={{ color: '#f472b6', fontWeight: '600', fontSize: '14px' }}>{user.role}</span>
          </div>
          {links.map((link) => (
            <button
              key={link.path}
              onClick={() => go(link.path)}
              style={{
                ...navLinkStyle(isActive(link.path)),
                textAlign: 'left',
                fontSize: '16px',
                padding: '13px 16px',
                width: '100%',
                boxSizing: 'border-box',
              }}
            >
              {link.label}
            </button>
          ))}
          <button
            onClick={logout}
            style={{
              ...logoutStyle,
              width: '100%',
              boxSizing: 'border-box',
              padding: '13px 16px',
              marginTop: '6px',
            }}
          >
            Logout
          </button>
        </div>
      )}
    </nav>
  );
}

const navLinkStyle = (active: boolean) => ({
  background: active ? 'rgba(244, 114, 182, 0.15)' : 'none',
  border: 'none',
  color: active ? '#f472b6' : '#e0e7ff',
  fontWeight: '600' as const,
  cursor: 'pointer',
  fontSize: '17px',
  padding: '8px 20px',
  borderRadius: '999px',
  transition: 'all 0.2s',
});

const logoutStyle = {
  padding: '10px 26px',
  background: '#ef4444',
  border: 'none',
  borderRadius: '999px',
  color: 'white',
  fontWeight: '600' as const,
  cursor: 'pointer',
  fontSize: '15px',
};
