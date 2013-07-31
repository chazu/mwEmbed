( function( mw, $ ) {"use strict";

	mw.PluginManager.add( 'currentTimeLabel', mw.KBaseComponent.extend({

		defaultConfig: {
			"parent": "controlsContainer",
         	"order": 3
		},

		setup: function(){
			var _this = this;
			this.bind( 'timeupdate', function(){

				var ct = _this.getPlayer().currentTime - _this.getPlayer().startOffset;
				if( ct < 0 ){
					ct = 0;
				}

				_this.getComponent().text( mw.seconds2npt( parseFloat( ct ) ) );
			});
		},
		getComponent: function() {
			if( !this.$el ) {
				this.$el = $( '<div />' )
					.addClass ( "timers currentTime" )
					.text( '0:00' );
			}
			return this.$el;
		}
	}));

} )( window.mw, window.jQuery );		