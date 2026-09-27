import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Following, History, Home, Popular, Search, WatchLater } from './pages/Feeds'
import Video from './pages/Video'
import Favourites from './pages/Favourites'
import Messages from './pages/Messages'
import Me, { UserPage } from './pages/Me'
import Publish from './pages/Publish'
import Polls, { Dynamics } from './pages/Polls'
import DirectMessage from './pages/DirectMessage'
import Settings from './pages/Settings'

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/popular" element={<Popular />} />
        <Route path="/following" element={<Following />} />
        <Route path="/search" element={<Search />} />
        <Route path="/video/:bvid" element={<Video />} />
        <Route path="/favourites" element={<Favourites />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/dm/:talkerId" element={<DirectMessage />} />
        <Route path="/history" element={<History />} />
        <Route path="/watchlater" element={<WatchLater />} />
        <Route path="/polls" element={<Polls />} />
        <Route path="/dynamics" element={<Dynamics />} />
        <Route path="/publish" element={<Publish />} />
        <Route path="/me" element={<Me />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/user/:mid" element={<UserPage />} />
        <Route path="*" element={<div className="p-8 text-center dim">找不到這個頁面</div>} />
      </Routes>
    </Layout>
  )
}
