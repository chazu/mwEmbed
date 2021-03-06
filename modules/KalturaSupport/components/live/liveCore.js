( function( mw, $ ) {"use strict";

	mw.PluginManager.add( 'liveCore', mw.KBasePlugin.extend({

		firstPlay : false,
		/**
		 * API requests interval for updating live stream status (Seconds).
		 * Default is 30 seconds, to match server's cache expiration
		 */
		liveStreamStatusInterval : 10,

		// Default DVR Window (Seconds)
		defaultDVRWindow : 30 * 60,

		onAirStatus: true,

		dvrTimePassed: 0,

		defaultConfig: {
			//whether to start backwards timer on pause in iOS
			updateIOSPauseTime: false,
			//time in ms to wait before displaying the offline alert
			offlineAlertOffest: 1000,
			//disable the islive check (force live to true)
			disableLiveCheck: false,
			//hide live indicators when playing offline from DVR
			hideOfflineIndicators: false
		},

		/**
		 * indicates the last "current time" displayed. (will be used in iOS - where we sometimes override the current time)
		 */
		lastShownTime: 0,

		/**
		 * (only for iOS) indicates we passed the dvr window size and once we will seek backwards we should reAttach timUpdate events
		 */
		shouldReAttachTimeUpdate: false,

		playWhenOnline:false,

		setup: function() {
			this.addPlayerBindings();
			this.extendApi();
		},
		/**
		 * Extend JS API to match the KDP
		 */
		extendApi: function() {
			var _this = this;

			this.getPlayer().isOffline = function() {
				return !_this.onAirStatus;
			}
		},

		addPlayerBindings: function() {
			var _this = this;
			var embedPlayer = this.getPlayer();

			this.bind( 'checkIsLive', function( e, callback ) {
				_this.getLiveStreamStatusFromAPI( callback );
			});

			this.bind( 'playerReady', function() {
				_this.isLiveChanged();
			} );

			this.bind( 'onpause', function() {
				if ( embedPlayer.isLive() && _this.isDVR() && _this.switchDone ) {
					embedPlayer.addPlayerSpinner();
					_this.getLiveStreamStatusFromAPI( function( onAirStatus ) {
						if ( onAirStatus ) {
							if ( _this.shouldHandlePausedMonitor() ) {
								_this.addPausedMonitor();
							}
						}
					} );
				}
			} );

			this.bind( 'firstPlay', function() {
				_this.firstPlay = true;
			} );

			this.bind( 'AdSupport_PreSequenceComplete', function() {
				_this.switchDone = true;
			} );

			this.bind( 'liveStreamStatusUpdate', function( e, onAirObj ) {
				//check for pending autoPlay
				if ( onAirObj.onAirStatus && embedPlayer.firstPlay && embedPlayer.autoplay ) {
					embedPlayer.play();
				}

				//if we moved from live to offline  - show message
				if ( _this.onAirStatus && !onAirObj.onAirStatus ) {

					//simetimes offline is only for a second and the message is not needed..
					setTimeout( function() {
						if ( !_this.onAirStatus ) {
							//if we already played once it means stream data was loaded. We can continue playing in "VOD" mode
							if ( !_this.isNativeHLS() && !embedPlayer.firstPlay && _this.isDVR() ) {
								embedPlayer.triggerHelper( 'liveEventEnded' );
							} else {
								//remember last state
								_this.playWhenOnline = embedPlayer.isPlaying();
								embedPlayer.layoutBuilder.displayAlert( { title: embedPlayer.getKalturaMsg( 'ks-LIVE-STREAM-OFFLINE-TITLE' ), message: embedPlayer.getKalturaMsg( 'ks-LIVE-STREAM-OFFLINE' ), keepOverlay: true } );
								_this.getPlayer().disablePlayControls();
							}

						}
					}, _this.getConfig( 'offlineAlertOffest' ) );

					embedPlayer.triggerHelper( 'liveOffline' );

				}  else if ( !_this.onAirStatus && onAirObj.onAirStatus ) {
					embedPlayer.layoutBuilder.closeAlert(); //moved from offline to online - hide the offline alert
					if ( !_this.getPlayer().getError() ) {
						_this.getPlayer().enablePlayControls();
					}
					if ( _this.playWhenOnline ) {
						embedPlayer.play();
						_this.playWhenOnline = false;
					}
					embedPlayer.triggerHelper( 'liveOnline' );
				}

				_this.onAirStatus = onAirObj.onAirStatus;

				if ( _this.isDVR() ) {
					if ( !onAirObj.onAirStatus ) {
						embedPlayer.triggerHelper('onHideInterfaceComponents', [['liveBackBtn']] );
						if ( _this.shouldHandlePausedMonitor() ) {
							_this.removePausedMonitor();
						}
					} else if ( _this.firstPlay ) {  //show "back to live" button only after first play
						embedPlayer.triggerHelper('onShowInterfaceComponents', [['liveBackBtn']] );
					}
				}
			} );

			this.bind( 'durationChange', function( e, newDuration) {
				if ( _this.switchDone && embedPlayer.isLive() && _this.isDVR() ) {
					//duration should be at least dvrWindow size (with 10% tolerance)
					if ( newDuration < 0.9 * (_this.dvrWindow) ) {
						embedPlayer.setDuration( _this.dvrWindow );
					}
				}
			});

			this.bind( 'liveEventEnded', function() {
				if ( embedPlayer.isLive() && _this.isDVR() ) {
					//change state to "VOD"
					embedPlayer.setLive( false );
					if ( _this.getConfig('hideOfflineIndicators') ) {
						_this.isLiveChanged();
					} else {
						//once moving back to live, set live state again
						embedPlayer.bindHelper( 'movingBackToLive', function() {
							embedPlayer.setLive( true );
						} );
					}
					embedPlayer.setDuration(  embedPlayer.getPlayerElement().duration  );
					//'ended' will be sent for js layer, update the player position for next replay
					embedPlayer.bindHelper( 'ended', function() {
						embedPlayer.getPlayerElement().seek( 0 );
					} );
				}
			});
		},

		isLiveChanged: function() {
			var _this = this;
			var embedPlayer = this.getPlayer();

			//ui components to hide
			var showComponentsArr = [];
			//ui components to show
			var hideComponentsArr = [];
			hideComponentsArr.push( 'liveBackBtn' );
			_this.dvrTimePassed = 0;
			_this.lastShownTime = 0;
			//live entry
			if ( embedPlayer.isLive() ) {
				_this.addLiveStreamStatusMonitor();
				//hide source selector until we support live streams switching
				hideComponentsArr.push( 'sourceSelector' );
				embedPlayer.addPlayerSpinner();
				_this.getLiveStreamStatusFromAPI( function( onAirStatus ) {
					if ( !embedPlayer._checkHideSpinner ) {
						embedPlayer.hideSpinner();
					}
				} );
				_this.switchDone = true;
				if ( embedPlayer.sequenceProxy ) {
					_this.switchDone = false;
				}

				//live + DVR
				if ( _this.isDVR() ) {
					_this.dvrWindow = embedPlayer.evaluate( '{mediaProxy.entry.dvrWindow}' ) * 60;
					if ( !_this.dvrWindow ) {
						_this.dvrWindow = _this.defaultDVRWindow;
					}
					if ( _this.isNativeHLS() ) {
						embedPlayer.setDuration( _this.dvrWindow );
					}
					showComponentsArr.push( 'scrubber', 'durationLabel', 'currentTimeLabel' );
				} else {  //live + no DVR
					showComponentsArr.push( 'liveStatus' );
					hideComponentsArr.push( 'scrubber', 'durationLabel', 'currentTimeLabel' );
				}

				if ( _this.isNativeHLS() ) {
					_this.bind( 'timeupdate' , function() {
						var curTime = embedPlayer.getPlayerElementTime();

						// handle timeupdate if pausedTimer was turned on
						if ( _this.dvrTimePassed != 0 ) {
							var lastShownTime = _this.lastShownTime;
							if ( lastShownTime == 0 ) {
								lastShownTime = curTime;
							}
							var accurateTime =  lastShownTime - _this.dvrTimePassed;
							if ( accurateTime < 0 ) {
								accurateTime = 0
							}
							if ( accurateTime > embedPlayer.duration ) {
								accurateTime = embedPlayer.duration;
							}
							_this.updateTimeAndScrubber( accurateTime );

						}
						//handle bug in iOS: currenttime exceeds duration
						else if ( curTime > embedPlayer.duration ) {
							embedPlayer.triggerHelper( 'detachTimeUpdate' );
							embedPlayer.triggerHelper( 'externalTimeUpdate', [ embedPlayer.duration ] );
							_this.lastShownTime =  embedPlayer.duration;
							_this.shouldReAttachTimeUpdate = true;
						}
						else if ( _this.dvrTimePassed == 0 && _this.shouldReAttachTimeUpdate) {
							_this.sendReAttacheTimeUpdate();
						}
					});
				}

				if ( _this.shouldHandlePausedMonitor() ) {

					_this.bind( 'onplay', function() {
						if ( _this.isDVR() && _this.switchDone ) {
							//	_this.hideLiveStreamStatus();
							_this.removePausedMonitor();
						}
					} );

					_this.bind( 'seeking movingBackToLive', function() {
						//if we are keeping track of the passed time from a previous pause - reset it
						if ( _this.dvrTimePassed != 0 ) {
							_this.dvrTimePassed = 0;
							_this.sendReAttacheTimeUpdate();
						}
					});
				}
			}
			//not a live entry: restore ui, hide live ui
			else {
				hideComponentsArr.push( 'liveStatus' );
				showComponentsArr.push( 'sourceSelector', 'scrubber', 'durationLabel', 'currentTimeLabel' );
				_this.removeLiveStreamStatusMonitor();
			}

			embedPlayer.triggerHelper('onShowInterfaceComponents', [ showComponentsArr ] );
			embedPlayer.triggerHelper('onHideInterfaceComponents', [ hideComponentsArr ] );
		},

		sendReAttacheTimeUpdate: function() {
			this.getPlayer().triggerHelper( 'reattachTimeUpdate' );
			this.lastShownTime = 0;
			this.shouldReAttachTimeUpdate = false
		},


		updateTimeAndScrubber: function( val ) {
			var embedPlayer = this.getPlayer();
			embedPlayer.triggerHelper( 'externalTimeUpdate', [ val ] );
			var playHeadPercent = ( val - embedPlayer.startOffset ) / embedPlayer.duration;
			embedPlayer.triggerHelper( 'externalUpdatePlayHeadPercent', [ playHeadPercent ] );
		},

		isDVR: function(){
			return this.getPlayer().evaluate( '{mediaProxy.entry.dvrStatus}' );
		},

		getCurrentTime: function() {
			return this.getPlayer().getPlayerElement().currentTime;
		},

		removeMinDVRMonitor: function() {
			this.log( "removeMinDVRMonitor" );
			this.minDVRMonitor = clearInterval( this.minDVRMonitor );
		},

		/**
		 * API Requests to update on/off air status
		 */
		addLiveStreamStatusMonitor: function() {
			//if player is in error state- no need for islive calls
			if ( this.embedPlayer.getError() ) {
				return;
			}
			this.log( "addLiveStreamStatusMonitor" );
			var _this = this;
			this.liveStreamStatusMonitor = setInterval( function() {
				_this.getLiveStreamStatusFromAPI();
			}, _this.liveStreamStatusInterval * 1000 );
		},

		removeLiveStreamStatusMonitor: function() {
			this.log( "removeLiveStreamStatusMonitor" );
			this.liveStreamStatusMonitor = clearInterval( this.liveStreamStatusMonitor );
		},

		/**
		 * indicates if we should handle paused monitor.
		 * relevant only on iOS and if updateIOSPauseTime flag is true
		 */
		shouldHandlePausedMonitor: function() {
			if ( this.isNativeHLS() && this.getConfig('updateIOSPauseTime') ) {
				return true;
			}
			return false;
		},

		/**
		 * Updating display time & scrubber while in paused state
		 */
		addPausedMonitor: function() {
			var _this = this;
			var embedPlayer = this.embedPlayer;
			var vid = embedPlayer.getPlayerElement();
			var pauseTime = _this.lastShownTime;
			if ( pauseTime == 0 ) {
				pauseTime = vid.currentTime;
			}
			var pauseClockTime = Date.now();
			//ignore timeupdate native events, we will calculate the accurate time value and update the timers
			embedPlayer.triggerHelper( 'detachTimeUpdate' );
			this.log( "addPausedMonitor :   Monitor rate = " + mw.getConfig( 'EmbedPlayer.MonitorRate' ) );
			this.pausedMonitor = setInterval( function() {
				var timePassed = ( Date.now() - pauseClockTime ) / 1000;
				var newTime = pauseTime - timePassed;
				if ( newTime >= 0 ) {
					_this.dvrTimePassed = timePassed;
					_this.updateTimeAndScrubber( newTime );
				}
			}, 1000 );
		},

		removePausedMonitor: function() {
			this.log( "removePausedMonitor" );
			this.pausedMonitor = clearInterval( this.pausedMonitor );
		},

		/**
		 * Get on/off air status based on the API and update locally
		 */
		getLiveStreamStatusFromAPI: function( callback ) {
			var _this = this;
			var embedPlayer = this.getPlayer();

			if ( embedPlayer.getFlashvars( 'streamerType') == 'rtmp' ) {
				if ( callback ) {
					callback( _this.onAirStatus );
				}
				return;
			}

			if (this.getConfig("disableLiveCheck")){
				if ( callback ) {
					callback( true );
				}
				embedPlayer.triggerHelper( 'liveStreamStatusUpdate', { 'onAirStatus' : true } );
				return;
			}

			var service = 'liveStream';
			//type liveChannel
			if ( embedPlayer.kalturaPlayerMetaData && embedPlayer.kalturaPlayerMetaData.type == 8 ) {
				service = 'liveChannel';
			}
			var protocol = 'hls';
			if ( embedPlayer.streamerType != 'http' ) {
				protocol = embedPlayer.streamerType;
			}
			_this.getKalturaClient().doRequest( {
				'service' : service,
				'action' : 'islive',
				'id' : embedPlayer.kentryid,
				'protocol' : protocol,
				'partnerId': embedPlayer.kpartnerid
			}, function( data ) {
				var onAirStatus = false;
				if ( data === true ) {
					onAirStatus = true;
				}
				if ( callback ) {
					callback( onAirStatus );
				}
				embedPlayer.triggerHelper( 'liveStreamStatusUpdate', { 'onAirStatus' : onAirStatus } );
			},mw.getConfig("SkipKSOnIsLiveRequest") );
		},

		getKalturaClient: function() {
			if( ! this.kClient ) {
				this.kClient = mw.kApiGetPartnerClient( this.embedPlayer.kwidgetid );
			}
			return this.kClient;
		},

		log: function( msg ) {
			mw.log( "LiveStream :: " + msg);
		},

		isNativeHLS: function() {
			if ( mw.isIOS() || mw.isDesktopSafari() ) {
				return true;
			}

			return false;
		}

	}));

} )( window.mw, window.jQuery );