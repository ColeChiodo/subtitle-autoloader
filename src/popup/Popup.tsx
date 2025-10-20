import ReactDOM from 'react-dom/client';
import '../index.css';
import './popup.css';
import manifest from '../../public/manifest.json'; // adjust path if needed

function AboutPage() {
	const version = manifest.version;

	const openSettings = () => {
		// Works in Chrome and Firefox
		if (chrome.runtime.openOptionsPage) {
			chrome.runtime.openOptionsPage();
		} else {
			window.open(chrome.runtime.getURL('settings.html'));
		}
	};

	return (
		<div className="p-8">
			<div className="m-4 p-8 bg-[#282828] text-[#ebdbb2] flex flex-col items-center justify-center min-h-screen">
				<img
					src="/assets/icons/cc-icon-white.png"
					alt="Kurami Logo"
					className="my-4 max-w-[100px] max-h-[100px] border-4 border-[#fabd2f]"
				/>
				<div className="flex flex-col items-center gap-0">
					<div className="text-xl font-semibold">Kuraji</div>
					<div className="text-2xl font-semibold text-[#fabd2f]">「クラジ」</div>
				</div>
				<p className="text-sm text-[#bdae93] mb-4 text-center">
					Automatically searches for and loads Japanese subtitles for your videos.
				</p>

				<div className="bg-[#3c3836] p-4 rounded-lg w-full max-w-xs text-center">
					<p className="text-[#ebdbb2] mb-2">
						Version: <span className="font-semibold">{version}</span>
					</p>
					<p className="text-[#bdae93]">
						Status: <span className="text-[#b8bb26]">Ready ✅</span>
					</p>
				</div>

				{/* Settings Button */}
				<button
					onClick={openSettings}
					className="mt-6 bg-[#fabd2f] text-[#282828] px-4 py-2 rounded hover:bg-[#d79921] font-semibold"
				>
					Open Settings ⚙️
				</button>

				<p className="text-xs text-[#928374] mt-6 text-center">
					© 2025{' '}
					<a
						href="https://colechiodo.cc"
						className="text-[#928374] hover:underline no-underline hover:text-[#fabd2f]"
					>
						colechiodo.cc
					</a>
				</p>
			</div>
		</div>
	);
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<AboutPage />);
