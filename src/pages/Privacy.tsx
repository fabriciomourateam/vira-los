export default function Privacy() {
  return (
    <div style={{ maxWidth: 700, margin: '60px auto', padding: '0 24px', fontFamily: 'sans-serif', lineHeight: 1.7, color: '#222' }}>
      <h1>Privacy Policy</h1>
      <p><strong>Last updated:</strong> March 2026</p>
      <p>ViralOS is a private content scheduling tool. We collect only the minimum data necessary to operate the service.</p>
      <h2>Data We Collect</h2>
      <ul>
        <li>OAuth access tokens for connected social media accounts (TikTok, Instagram, YouTube)</li>
        <li>Content you upload for scheduling (videos, images)</li>
        <li>Scheduling preferences and settings</li>
      </ul>
      <h2>How We Use Your Data</h2>
      <p>Your data is used solely to publish content to your connected social media accounts at scheduled times. We do not sell or share your data with third parties.</p>
      <h2>Data Storage</h2>
      <p>Data is stored securely on our servers. Access tokens are stored encrypted and used only for publishing on your behalf.</p>
      <h2>Your Rights</h2>
      <p>You can disconnect any platform at any time, which will delete the associated access tokens from our system.</p>
      <h2>Contact</h2>
      <p>For privacy concerns, contact us at <a href="mailto:contato@fabriciomoura.com">contato@fabriciomoura.com</a></p>
    </div>
  );
}
