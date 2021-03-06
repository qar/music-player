import React from 'react';
import PlayControl from 'components/Player/PlayControl';
import PlayQueue from 'components/Player/PlayQueue';
import PlayProgressBar from 'components/Player/PlayProgressbar';
import PlayDuration from 'components/Player/PlayDuration';
import PlayModeControl from 'components/Player/PlayModeControl';
import PlayVolumeControl from 'components/Player/PlayVolumeControl';
import GenresMenu from 'components/App/GenresMenu';
import AccountSettings from 'components/account-settings';
import MediaInfo from 'components/App/MediaInfo';
import path from 'path';
import fs from 'fs';
import { remote, ipcRenderer } from 'electron';
import playerStyles from 'components/Player/Player.scss';
import regionStyles from './region.scss';
import jsmediatags from 'jsmediatags';
import getCoverFromMP3File from 'utils/getCoverFromMP3File';
import 'styles/scrollbar.scss';

const soundsDb = remote.getGlobal('soundsDb');
const MEDIA_DIR = remote.getGlobal('MEDIA_DIR');
const COVERS_DIR = remote.getGlobal('COVERS_DIR');
const events = remote.getGlobal('events');

class App extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      queue: [],
      passTime: 0,
      totalTime: 0,
      isPlaying: false,
      isListRepeat: true,
      volume: 40,
      showSettings: false,
      currentSongId: '',
      currentSongCover: '',
    };

    this.playerSetup();
    this.currentSong = null;

    events.on('goto:settings', () => {
      this.setState({ showSettings: true });
    });

    events.on('play:toggle', () => {
      if (this.state.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    });

    events.on('play:previous', () => {
      this.prev();
    })

    events.on('play:next', () => {
      this.next();
    });

    soundsDb.find({}, (err, items) => {
      if (err) {
        // handle error
        return;
      }

      items.forEach(item => {
        item.path = path.resolve(MEDIA_DIR, [item._id, item.fileExt].join(''))

        if (!item.cover) {
          getCoverFromMP3File(item.path, cover => {
            // save file to disk
            const matches = cover.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
            const coverName = `${item.artist}-${item.album}.${matches[1]}`;
            const coverPath = path.resolve(COVERS_DIR, coverName);
            fs.writeFile(coverPath, matches[2], 'base64', function(err) {
              console.log(err);
              soundsDb.update({ _id: item._id }, { $set: { cover: coverPath }}, function(err, result) {
                // TODO handle err
              });
            });
          });
        }
      });

      this.setState({ queue: items });

      ipcRenderer.on('addNewItem', (ev, newItem) => {
        newItem.path = path.resolve(MEDIA_DIR, [newItem._id, newItem.fileExt].join(''))
        this.state.queue.push(newItem);
        this.setState({ queue: this.state.queue });
      });
    });
  }

  _findNextSound(currentSoundPth) {
    const idx = this.state.queue.findIndex(i => i.path === currentSoundPth);
    if (idx + 1 === this.state.queue.length) {
      return this.state.queue[0]; // return to the begining
    } else {
      return this.state.queue[idx + 1];
    }
  }

  _findPrevSound(currentSoundPth) {
    const idx = this.state.queue.findIndex(i => i.path === currentSoundPth);
    if (idx === 0) {
      return this.state.queue[0]; // remain at the beginning
    } else {
      return this.state.queue[idx - 1];
    }
  }

  playerSetup() {
    soundManager.setup({
      url: '/node_modules/soundmanager2/swf/soundmanager2.swf',
      useHighPerformance: true,
      onready: function() {
      },

      ontimeout: function() {
        // Hrmm, SM2 could not start. Missing SWF? Flash blocked? Show an error, etc.?
      }
    });
  }

  _updatePlayProgress(position, durationEstimate, duration) {
    var width,
        passMinutes,
        passSeconds,
        totalMinutes,
        totalSeconds;

    passMinutes = Math.floor(position / 1000 / 60);
    passSeconds = Math.ceil(position / 1000 - passMinutes * 60);
    var passTime = (passMinutes >= 10 ? passMinutes.toString() : '0' + passMinutes) +
                    ':' +
                    (passSeconds >= 10 ? passSeconds.toString() : '0' + passSeconds);

    this.state.passTime = passTime;
    this.setState({ passTime });

    if (!this.state.totalTime) {
      totalMinutes = Math.floor(durationEstimate / 1000 / 60);
      totalSeconds = Math.ceil(duration / 1000 - totalMinutes * 60);
      var totalTime = (totalMinutes >= 10 ? totalMinutes.toString() : '0' + totalMinutes) +
                      ':' +
                      (totalSeconds >= 10 ? totalSeconds.toString() : '0' + totalSeconds);
      this.setState({ totalTime });
    }

    this.state.durationEstimate = durationEstimate;
    this.setState({ durationEstimate });

    width = Math.min(100, Math.max(0, (100 * position / durationEstimate))) + '%';

    if (duration) {
      this.setState({ width });
    }
  }

  _createSoundOpts() {
    const _this = this;

    return {
      volume: this.state.volume,

      onplay: () => {
        this.setState({ isPlaying: true });
      },

      onresume: () => {
        this.setState({ isPlaying: true });
      },

      onpause: () => {
        this.setState({ isPlaying: false });
      },

      whileplaying: function() {
        _this._updatePlayProgress(this.position, this.durationEstimate, this.duration);
      },

      onstop: () => {
        this.setState({
          passTime: 0,
          totalTime: 0,
          width: '0%',
          isPlaying: false,
          currentSongId: '',
          currentSongCover: ''
        });
      },
    };
  }

  _playCount() {
    soundsDb.findOne({ _id: this.state.currentSongId }, (err, sound) => {
      if (err) {
        // handle error
        return
      }

      if (!sound.playCount) {
        sound.playCount = 0;
      }

      sound.playCount += 1;

      soundsDb.update({ _id: this.state.currentSongId }, { $set: { playCount: sound.playCount }}, (err, sound) => {
        if (err) {
          // handle error
        }
      });

      this.state.queue.forEach(i => {
        if (i._id === this.state.currentSongId) {
          i.playCount = sound.playCount;
        }
      });

      this.setState({ queue: this.state.queue });
    });
  }

  prepareSong(url) {
    const globalState = this.state;
    const _this = this;

    const nextSoundPath = this._findNextSound(url).path;

    const opts = Object.assign({}, this._createSoundOpts(),  {
      url,
      onfinish: () => {
        this.setState({
          width: '0%',
          isPlaying: false,
          passTime: 0,
          totalTime: 0,
        });

        this._playCount();

        if (!this.state.isListRepeat) {
          this.currentSong.play();
        } else {
          this.prepareSong(nextSoundPath).play();
        }
      }
    });

    getCoverFromMP3File(url, cover => {
      const id = path.parse(url).name;
      this.setState({ currentSongId: id, currentSongCover: cover });
    });

    this.currentSong = soundManager.createSound(opts);
    return this.currentSong;
  }

  play() {
    if (!this.currentSong) return;

    if (!this.state.isPlaying && this.state.passTime) {
      // is paused
      this.currentSong.resume();
    } else {
      this.currentSong.play();
    }
  }

  // switch song
  playItem(path) {
    this.stop();

    this.prepareSong(path);

    this.play();
  }

  pause() {
    this.currentSong.pause();
  }

  prev() {
    if (!this.currentSong) return;
    const prevSoundPath = this._findPrevSound(this.currentSong.url).path;
    this.currentSong.stop();
    this.prepareSong(prevSoundPath).play();
  }

  next() {
    if (!this.currentSong) return;
    const prevSoundPath = this._findNextSound(this.currentSong.url).path;
    this.currentSong.stop();
    this.prepareSong(prevSoundPath).play();
  }

  stop() {
    if (!this.currentSong) return;

    this.currentSong.stop();
  }

  setVolume(volume) {
    this.setState({ volume });
    soundManager.setVolume(volume);
  }

  setPos(rate) {
    this.currentSong.setPosition(this.currentSong.durationEstimate * rate);
  }

  repeatList() {
    this.setState({ isListRepeat: true });
  }

  repeatItem() {
    this.setState({ isListRepeat: false });
  }

  _renderMainZone() {
    if (this.state.showSettings) {
      return <AccountSettings />
    } else {
      return <div className="col-md-12">
          <PlayQueue play={ (path) => this.playItem(path) } queue={ this.state.queue } currentSound={ this.currentSong ? this.currentSong.url : '' } />
        </div>
    }
  }

  render() {
    return (
      <div>
        <div className={ regionStyles.header_zone }>
          <div className={ regionStyles.brand_box }>
            <span>Music Archive</span>
          </div>
          <div className={ regionStyles.view_box }></div>
          <div className={ regionStyles.search_box }></div>
        </div>

        <div className={ regionStyles.play_zone }>
          <div className={ regionStyles.media_info }>
            <MediaInfo media={ this.state.currentSongId } cover={ this.state.currentSongCover } />
          </div>

          <div className={ regionStyles.controls_bar }>
            <PlayControl onPlayBtnClicked={ () => this.play() }
                         onPauseBtnClicked={ () => this.pause() }
                         onPrevBtnClicked={ () => this.prev() }
                         onNextBtnClicked={ () => this.next() }
                         onStopBtnClicked={ () => this.stop() }
                         isPlaying={ this.state.isPlaying } />

            <div className={ regionStyles.play_progress_bar }>
              <PlayProgressBar barProgress={this.state.width} setPos={ this.setPos.bind(this) } />
            </div>

            <div className={ regionStyles.volume_mode_control }>
              <PlayVolumeControl volume={ this.state.volume } setVolume={ this.setVolume.bind(this) } />
              <PlayModeControl isListRepeat={ this.state.isListRepeat } onListRepeatClicked={ this.repeatItem.bind(this) } onItemRepeatClicked={ this.repeatList.bind(this) } />
            </div>
          </div>
        </div>

        <div className={ regionStyles.library_zone }>
          <div className={ regionStyles.play_list_box }>
            <GenresMenu />
          </div>

          <div className={ regionStyles.media_box }>
            <PlayQueue play={ (path) => this.playItem(path) } queue={ this.state.queue } currentSound={ this.currentSong ? this.currentSong.url : '' } />
          </div>
          <div className={ regionStyles.activity_box }></div>
        </div>
      </div>
    );
  }
}

export default App;
