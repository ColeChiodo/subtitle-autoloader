import ReactDOM from 'react-dom/client';
import { useEffect, useState } from 'react';
import '../index.css';
import './settings.css';
import manifest from '../../public/manifest.json'; // adjust path if needed
import browser from 'webextension-polyfill';

function SettingsPage() {
	const version = manifest.version;
	const [token, setToken] = useState('');
	const [status, setStatus] = useState('');

	useEffect(() => {
		(async () => {
			const data = (await browser.storage.local.get('githubToken')) as { githubToken?: string };
            if (data.githubToken) setToken(data.githubToken);
		})();
	}, []);

	const saveToken = async () => {
		await browser.storage.local.set({ githubToken: token.trim() });
		setStatus('✅ Token saved!');
		setTimeout(() => setStatus(''), 2000);
	};

	return (
		<div className="p-8 bg-[#282828] text-[#ebdbb2] min-h-screen flex flex-col items-center">
			<h1 className="text-2xl font-bold mb-4 text-[#fabd2f]">Kuraji Settings</h1>

			<div className="bg-[#3c3836] p-4 rounded-lg w-full max-w-md text-center">
				<label htmlFor="githubToken" className="block mb-2 font-semibold">
					GitHub API Token
				</label>
				<input
					id="githubToken"
					type="password"
					value={token}
					onChange={(e) => setToken(e.target.value)}
					placeholder="Paste your token here"
					className="w-full p-2 rounded bg-[#504945] text-[#ebdbb2] border border-[#665c54]"
				/>
				<button
					onClick={saveToken}
					className="mt-4 bg-[#fabd2f] text-[#282828] px-4 py-2 rounded hover:bg-[#d79921] font-semibold"
				>
					Save Token
				</button>
				{status && <p className="mt-2 text-[#b8bb26]">{status}</p>}
			</div>

			<p className="text-sm text-[#bdae93] mt-6">Version {version}</p>
		</div>
	);
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<SettingsPage />);
