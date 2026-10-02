import { useNavigate, useLocation } from 'react-router-dom';

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const logout = () => {
    localStorage.clear();
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav style={{
      background: 'rgba(5, 6, 15, 0.97)',
      backdropFilter: 'blur(16px)',
      padding: '18px 40px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottom: '1px solid rgba(244, 114, 182, 0.15)',
      position: 'sticky',
      top: 0,
      zIndex: 1000,
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '48px' }}>
        <div
          onClick={() => navigate('/dashboard')}
          style={{
            fontSize: '34px',
            fontWeight: '900',
            background: 'linear-gradient(90deg, #f472b6, #fb923c, #facc15)',
            WebkitBackgroundClip: 'text',
            color: 'transparent',
            cursor: 'pointer',
            letterSpacing: '-1.5px'
          }}
        >
          STUDS
        </div>

        <div style={{ display: 'flex', gap: '32px' }}>
          {/* Student Links */}
          {user.role === 'STUDENT' && (
            <>
              <button onClick={() => navigate('/dashboard')} style={navLinkStyle(isActive('/dashboard'))}>Home</button>
              <button onClick={() => navigate('/menu')} style={navLinkStyle(isActive('/menu'))}>Menu</button>
              <button onClick={() => navigate('/orders')} style={navLinkStyle(isActive('/orders'))}>My Orders</button>
              <button onClick={() => navigate('/wallet')} style={navLinkStyle(isActive('/wallet'))}>Wallet</button>
              <button onClick={() => navigate('/profile')} style={navLinkStyle(isActive('/profile'))}>Profile</button>
            </>
          )}

          {/* Vendor Links */}
          {user.role === 'VENDOR' && (
            <>
              <button onClick={() => navigate('/vendor/dashboard')} style={navLinkStyle(isActive('/vendor/dashboard'))}>My Shop</button>
              <button onClick={() => navigate('/vendor/orders')} style={navLinkStyle(isActive('/vendor/orders'))}>Orders</button>
            </>
          )}

          {/* Rider Links */}
          {user.role === 'RIDER' && (
            <button onClick={() => navigate('/rider')} style={navLinkStyle(isActive('/rider'))}>Rider Hub</button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        <div style={{ color: '#e0e7ff', fontSize: '15px', textAlign: 'right' }}>
          {user.name} <br />
          <span style={{ color: '#f472b6', fontWeight: '600', fontSize: '14px' }}>{user.role}</span>
        </div>
        <button
          onClick={logout}
          style={{
            padding: '10px 26px',
            background: '#ef4444',
            border: 'none',
            borderRadius: '999px',
            color: 'white',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          Logout
        </button>
      </div>
    </nav>
  );
}

const navLinkStyle = (active: boolean) => ({
  background: active ? 'rgba(244, 114, 182, 0.15)' : 'none',
  border: 'none',
  color: active ? '#f472b6' : '#e0e7ff',
  fontWeight: '600',
  cursor: 'pointer',
  fontSize: '17px',
  padding: '8px 20px',
  borderRadius: '999px',
  transition: 'all 0.2s'
});