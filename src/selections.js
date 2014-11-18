/**
 * selections.js is part of Aloha Editor project http://aloha-editor.org
 *
 * Aloha Editor is a WYSIWYG HTML5 inline editing library and editor.
 * Copyright (c) 2010-2014 Gentics Software GmbH, Vienna, Austria.
 * Contributors http://aloha-editor.org/contribution.php
 *
 * @TODO: better climbing
 *        ie support
 * @namespace selections
 */
define([
	'dom',
	'keys',
	'maps',
	'html',
	'mouse',
	'events',
	'arrays',
	'ranges',
	'carets',
	'browsers',
	'overrides',
	'animation',
	'boundaries',
	'traversing',
	'functions'
], function (
	Dom,
	Keys,
	Maps,
	Html,
	Mouse,
	Events,
	Arrays,
	Ranges,
	Carets,
	Browsers,
	Overrides,
	Animation,
	Boundaries,
	Traversing,
	Fn
) {
	'use strict';

	/**
	 * Hides all visible caret elements and returns all those that were hidden
	 * in this operation.
	 *
	 * @param  {Document} doc * @return {Array.<Element>}
	 */
	function hideCarets(doc) {
		var carets = doc.querySelectorAll('div.aloha-caret');
		var visible = [];
		[].forEach.call(carets, function (caret) {
			if ('block' === Dom.getStyle(caret, 'display')) {
				visible.push(caret);
				Dom.setStyle(caret, 'display', 'none');
			}
		});
		return visible;
	}

	/**
	 * Unhides the given list of caret elements.
	 *
	 * @param {Array.<Element>} carets
	 */
	function unhideCarets(carets) {
		carets.forEach(function (caret) {
			Dom.setStyle(caret, 'display', 'block');
		});
	}

	/**
	 * Renders the given element at the specified boundary to represent the
	 * caret position.
	 *
	 * @param {Element}  caret
	 * @param {Boundary} boundary
	 * @memberOf selections
	 */
	function show(caret, boundary) {
		var box = Carets.box(Boundaries.range(boundary, boundary));
		Maps.extend(caret.style, {
			'top'     : box.top + 'px',
			'left'    : box.left + 'px',
			'height'  : box.height + 'px',
			'width'   : '2px',
			'display' : 'block'
		});
	}

	/**
	 * Determines how to style a caret element based on the given overrides.
	 *
	 * @private
	 * @param  {Object} overrides
	 * @return {Object} A map of style properties and their values
	 */
	function stylesFromOverrides(overrides) {
		var style = {};
		style['padding'] = overrides['bold'] ? '1.5px' : '0px';
		style[Browsers.VENDOR_PREFIX + 'transform']
				= overrides['italic'] ? 'rotate(16deg)' : '';
		style['background'] = overrides['color'] || 'black';
		return style;
	}

	/**
	 * Given the boundaries checks whether the end boundary preceeds the start
	 * boundary in document order.
	 *
	 * @private
	 * @param  {Boundary} start
	 * @param  {Boundary} end
	 * @return {boolean}
	 */
	function isReversed(start, end) {
		var sc = Boundaries.container(start);
		var ec = Boundaries.container(end);
		var so = Boundaries.offset(start);
		var eo = Boundaries.offset(end);
		return (sc === ec && so > eo) || Dom.followedBy(ec, sc);
	}

	/**
	 * Creates a range that is `stride` pixels above the given offset bounds.
	 *
	 * @private
	 * @param  {Object.<string, number>} box
	 * @param  {number}                  stride
	 * @param  {Document}                doc
	 * @return {Range}
	 */
	function up(box, stride, doc) {
		var boundaries = Boundaries.fromPosition(box.left, box.top - stride, doc);
		return boundaries && Boundaries.range(boundaries[0], boundaries[1]);
	}

	/**
	 * Creates a range that is `stride` pixels below the given offset bounds.
	 *
	 * @private
	 * @param  {Object.<string, number>} box
	 * @param  {number}                  stride
	 * @return {Range}
	 */
	function down(box, stride, doc) {
		var boundaries = Boundaries.fromPosition(box.left, box.top + box.height + stride, doc);
		return boundaries && Boundaries.range(boundaries[0], boundaries[1]);
	}

	/**
	 * Given two ranges (represented in boundary tuples), creates a range that
	 * is between the two.
	 *
	 * @private
	 * @param  {Array.<Boundary>} a
	 * @param  {Array.<Boundary>} b
	 * @param  {string} focus Either "start" or "end"
	 * @return {Object}
	 */
	function mergeRanges(a, b, focus) {
		var start, end;
		if ('start' === focus) {
			start = a[0];
			end = b[1];
		} else {
			start = b[0];
			end = a[1];
		}
		if (isReversed(start, end)) {
			return {
				boundaries : [end, start],
				focus      : ('start' === focus) ? 'end' : 'start'
			};
		}
		return {
			boundaries : [start, end],
			focus      : focus
		};
	}

	/**
	 * Jumps the front or end position of the given editable.
	 *
	 * @private
	 * @param  {string}           direction "up" or "down"
	 * @param  {Event}            event
	 * @param  {Array.<Boundary>} boundaries
	 * @param  {string}           focus
	 * @return {Object}
	 */
	function jump(direction, event, boundaries, focus) {
		var boundary;
		if ('up' === direction) {
			boundary = Boundaries.create(event.editable.elem, 0);
			boundary = Html.expandForward(boundary);
		} else {
			boundary = Boundaries.fromEndOfNode(event.editable.elem);
			boundary = Html.expandBackward(boundary);
		}
		var next = [boundary, boundary];
		if (!Events.hasKeyModifier(event, 'shift')) {
			return {
				boundaries : next,
				focus      : focus
			};
		}
		return mergeRanges(next, boundaries, focus);
	}

	/**
	 * Finds the closest linebreaking element from the given node.
	 *
	 * @private
	 * @param  {!Node} node
	 * @return {?Element};
	 */
	function closestLine(node) {
		return Dom.upWhile(node, Fn.complement(Html.hasLinebreakingStyle));
	}

	/**
	 * Computes the visual range positoin above/below the given.
	 *
	 * @private
	 * @param  {!Range}    range
	 * @param  {!function} step
	 * @return {?Range}
	 */
	function climbStep(range, step) {
		var doc = range.commonAncestorContainer.ownerDocument;
		var docOffset = docOffsets(doc);
		var box = Carets.box(range);
		box.top -= docOffset.top;
		box.left -= docOffset.left;
		var half = box.height / 2;
		var stride = 0;
		var next;
		do {
			stride += half;
			next = step(box, stride, doc);
		} while (next && Ranges.equals(next, range));
		return next;
	}

	/**
	 * Computes a lists of box dimensions for the a given range.
	 *
	 * @private
	 * @param  {!Boundary} start
	 * @param  {!Boundary} end
	 * @return {Array.<Object>}
	 */
	function selectionBoxes(start, end) {
		var doc = Boundaries.document(start);
		var docOffset = docOffsets(doc);
		var offsetX = docOffset.left;
		var offsetY = docOffset.top;
		var endBox = Carets.box(Boundaries.range(end, end));
		var endTop = endBox.top;
		var endLeft = endBox.left;
		var range = Boundaries.range(start, start);
		var box, top, left, right, width, line, atEnd;
		var leftRange, rightRange;
		var boxes = [];
		while (range) {
			box = Carets.box(range);
			top = box.top;
			line = closestLine(range.startContainer);
			if (!line) {
				break;
			}
			atEnd = endTop < top + box.height;
			if (atEnd) {
				if (0 === boxes.length) {
					left = box.left;
				} else {
					left = Dom.offset(line).left;
				}
				width = endLeft - left;
			} else {
				if (0 === boxes.length) {
					left = box.left;
					width = elementWidth(line) - (left - Dom.offset(line).left);
				} else {
					left = Dom.offset(line).left;
					width = elementWidth(line);
				}
			}
			leftRange = Ranges.fromPosition(left - offsetX, top - offsetY, doc);
			rightRange = Ranges.fromPosition(left - offsetX + width, top - offsetY, doc);
			if (!leftRange || !rightRange) {
				break;
			}
			left = Carets.box(leftRange).left;
			right = Carets.box(rightRange).left;
			boxes.push({
				top    : top,
				left   : left,
				width  : right - left,
				height : box.height
			});
			if (atEnd) {
				break;
			}
			range = climbStep(range, down);
		}
		return boxes;
	}

	/**
	 * Renders divs to represent the given range
	 *
	 * @private
	 * @param  {!Boundary} start
	 * @param  {!Boundary} end
	 * @return {Array.<Element>}
	 */
	function highlight(start, end) {
		var doc = Boundaries.document(start);
		Dom.query('.aloha-selection-box', doc).forEach(Dom.remove);
		return selectionBoxes(start, end).map(function (box) {
			return drawBox(box, doc);
		});
	}

	/**
	 * Computes the offsets of the given document.
	 *
	 * @private
	 * @param  {!Document} doc
	 * @return {Object}
	 */
	function docOffsets(doc) {
		var win = Dom.documentWindow(doc);
		return {
			top  : win.pageYOffset - doc.body.clientTop,
			left : win.pageXOffset - doc.body.clientLeft
		};
	}

	/**
	 * Calculates the width of the given element as best as possible.
	 *
	 * We need to do this because clientWidth/clientHeight sometimes return 0
	 * erroneously.
	 *
	 * The difference between clientWidth and offsetWidth is that offsetWidth
	 * includes scrollbar size, but since we will almost certainly not have
	 * scrollbar within editing elements, this should not be a problem:
	 * http://stackoverflow.com/questions/4106538/difference-between-offsetheight-and-clientheight
	 *
	 * @private
	 * @param  {!Element} elem
	 * @return {number}
	 */
	function elementWidth(elem) {
		return elem.clientWidth || elem.offsetWidth;
	}

	/**
	 * Calculates the height of the given element as best as possible.
	 *
	 * We need to do this because clientWidth/clientHeight sometimes return 0
	 * erroneously.
	 *
	 * @private
	 * @see elementWidth
	 * @param  {!Element} elem
	 * @return {number}
	 */
	function elementHeight(elem) {
		return elem.clientHeight || elem.offsetHeight;
	}

	/**
	 * Checks whether the given node is a visible linebreaking non-void element.
	 *
	 * @private
	 * @param  {!Node} node
	 * @return {boolean}
	 */
	function isVisibleBreakingContainer(node) {
		return !Html.isVoidType(node)
		    && Html.isRendered(node)
		    && Html.hasLinebreakingStyle(node);
	}

	/**
	 * Checks whether the given node is a visible non-void element.
	 *
	 * @private
	 * @param  {!Node} node
	 * @return {boolean}
	 */
	function isVisibleContainer(node) {
		return !Html.isVoidType(node) && Html.isRendered(node);
	}

	/**
	 * Finds the breaking element above/below the given boundary.
	 *
	 * @private
	 * @param  {!Boundary} boundary
	 * @param  {!function} next
	 * @param  {!function} forwards
	 * @return {?Object}
	 */
	function findBreakpoint(boundary, next, forwards) {
		var node = next(boundary);
		var breaker = isVisibleBreakingContainer(node)
		            ? node
		            : forwards(node, isVisibleBreakingContainer);
		if (!breaker) {
			return null;
		}
		var isInsideBreaker = !!Dom.upWhile(node, function (node) {
			return node !== breaker;
		});
		return {
			breaker: breaker,

			// Because if the breaking node is an ancestor of the boundary
			// container, then the breakpoint ought to be calculated from the
			// top of the breaker, otherwise we ought to calculate it from the
			// bottom
			isInsideBreaker: isInsideBreaker
		};
	}

	/**
	 * Finds the visual boundary position above the given.
	 *
	 * Cases:
	 * foo<br>
	 * ba░r
	 *
	 * <p>foo</p>ba░r
	 *
	 * <p>foo</p><p>ba░r</p>
	 *
	 * foo<ul><li>ba░r</li></ul>
	 *
	 * @private
	 * @param  {!Boundary} boundary
	 * @return {Boundary}
	 */
	function moveUp(boundary) {
		var next;
		var range = Boundaries.range(boundary, boundary);
		var box = Carets.box(range);
		var breakpoint = findBreakpoint(
			boundary,
			Boundaries.prevNode,
			Dom.backwardPreorderBacktraceUntil
		);
		if (breakpoint) {
			var breaker = breakpoint.breaker;
			var offset = box.top - box.height;
			var breakOffset = Dom.absoluteTop(breaker);
			if (!breakpoint.isInsideBreaker) {
				breakOffset += elementHeight(breaker);
			}
			if (offset < breakOffset) {
				var above;
				if (breakpoint.isInsideBreaker) {
					above = Dom.nextNonAncestor(
						breaker,
						true,
						isVisibleContainer,
						Dom.isEditingHost
					);
				} else {
					above = breaker;
				}
				if (above) {
					if (Html.isGroupContainer(above)) {
						above = Dom.backwardPreorderBacktraceUntil(
							above.nextSibling,
							Html.isGroupedElement
						);
					}
					var aboveBoundary = Boundaries.raw(above, Dom.nodeLength(above));
					var aboveBox = Carets.box(Boundaries.range(
						aboveBoundary,
						aboveBoundary
					));
					var top;
					if (Dom.isTextNode(above)) {
						top = aboveBox.top + (aboveBox.height / 2);
					} else {
						top = Dom.absoluteTop(above)
						    + elementHeight(above)
						    - (aboveBox.height / 2);
					}
					var offsets = docOffsets(breaker.ownerDocument);
					next = Ranges.fromPosition(
						box.left - offsets.left,
						top - offsets.top,
						breaker.ownerDocument
					);
				}
			}
		}
		next = next || climbStep(range, up);
		return (!next || box.top === Carets.box(next).top)
		     ? boundary
		     : Boundaries.fromRangeStart(next);
	}

	/**
	 * Find the visual boundary position below the given.
	 *
	 * @private
	 * @param  {!Boundary} boundary
	 * @return {Boundary}
	 */
	function moveDown(boundary) {
		var next;
		var range = Boundaries.range(boundary, boundary);
		var box = Carets.box(range);
		var breakpoint = findBreakpoint(
			boundary,
			Boundaries.nextNode,
			Dom.forwardPreorderBacktraceUntil
		);
		if (breakpoint) {
			var breaker = breakpoint.breaker;
			var offset = box.top + box.height + box.height;
			var breakOffset = Dom.absoluteTop(breaker);
			if (breakpoint.isInsideBreaker) {
				breakOffset += elementHeight(breaker);
			}
			if (offset > breakOffset) {
				var below;
				if (breakpoint.isInsideBreaker) {
					below = Dom.nextNonAncestor(
						breaker,
						false,
						isVisibleContainer,
						Dom.isEditingHost
					);
				} else {
					below = breaker;
				}
				if (below) {
					if (Html.isGroupContainer(below)) {
						below = Dom.forwardPreorderBacktraceUntil(
							below.previousSibling,
							Html.isGroupedElement
						);
					}
					var belowBoundary = Boundaries.raw(below, 0);
					var belowBox = Carets.box(Boundaries.range(
						belowBoundary,
						belowBoundary
					));
					var top = Dom.isTextNode(below)
					        ? belowBox.top
					        : Dom.absoluteTop(below);
					top += belowBox.height / 2;
					var offsets = docOffsets(breaker.ownerDocument);
					next = Ranges.fromPosition(
						box.left - offsets.left,
						top - offsets.top,
						breaker.ownerDocument
					);
				}
			}
		}
		next = next || climbStep(range, down);
		return (!next || box.top === Carets.box(next).top)
		     ? boundary
		     : Boundaries.fromRangeStart(next);
	}

	/**
	 * Determines the closest visual caret position above or below the given
	 * range.
	 *
	 * @private
	 * @param  {string}           direction "up" or "down"
	 * @param  {Event}            event
	 * @param  {Array.<Boundary>} boundary
	 * @param  {string}           focus
	 * @return {Object}
	 */
	function climb(direction, event, boundaries, focus) {
		var boundary = boundaries['start' === focus ? 0 : 1];
		var next = 'up' === direction ? moveUp(boundary) : moveDown(boundary);
		if (!next) {
			return {
				boundaries : boundaries,
				focus      : focus
			};
		}
		if (Events.hasKeyModifier(event, 'shift')) {
			return mergeRanges([next, next], boundaries, focus);
		}
		return {
			boundaries : [next, next],
			focus      : focus
		};
	}

	/**
	 * Determines the next visual caret position before or after the given
	 * boundaries.
	 *
	 * @private
	 * @param  {string}           direction "left" or "right"
	 * @param  {Event}            event
	 * @param  {Array.<Boundary>} boundaries
	 * @param  {string}           focus
	 * @return {Object}
	 */
	function step(direction, event, boundaries, focus) {
		var shift = Events.hasKeyModifier(event, 'shift');
		var start = boundaries[0];
		var end = boundaries[1];
		var collapsed = Boundaries.equals(start, end);
		if (collapsed || !shift) {
			focus = ('left' === direction) ? 'start' : 'end';
		}
		var boundary = ('start' === focus)
		             ? start
		             : Traversing.envelopeInvisibleCharacters(end);
		if (collapsed || shift) {
			var stride = (Events.hasKeyModifier(event, 'ctrl')
			          || Events.hasKeyModifier(event, 'alt'))
			           ? 'word'
			           : 'visual';
			var next = ('left' === direction)
			         ? Traversing.prev(boundary, stride)
			         : Traversing.next(boundary, stride);
			if (Dom.isEditingHost(Boundaries.container(next))) {
				if (Boundaries.isAtStart(boundary)) {
					next = Html.expandForward(boundary);
				} else if (Boundaries.isAtEnd(boundary)) {
					next = Html.expandBackward(boundary);
				}
			}
			if (next) {
				boundary = next;
			}
		}
		if (shift) {
			return {
				boundaries : ('start' === focus) ? [boundary, end] : [start, boundary],
				focus      : focus
			};
		}
		return {
			boundaries : [boundary, boundary],
			focus      : focus
		};
	}

	/**
	 * Determines the dimensions of the vertical line in the editable at the
	 * given boundary position.
	 *
	 * @private
	 * @param  {Boundary} boundary
	 * @param  {Element}  editable
	 * @return {Object<string, number>}
	 */
	function lineBox(boundary, editable) {
		var docOffset = docOffsets(Boundaries.document(boundary));
		var rect = Carets.box(Boundaries.range(boundary, boundary));
		var node = Boundaries.container(boundary);
		if (Dom.isTextNode(node)) {
			node = node.parentNode;
		}
		var fontSize = parseInt(Dom.getComputedStyle(node, 'font-size'));
		var top = rect ? rect.top : Dom.absoluteTop(node);
		top -= docOffset.top;
		top += (fontSize ? fontSize / 2 : 0);
		var left = Dom.offset(editable).left - docOffset.left;
		return {
			top   : top,
			left  : left,
			right : left + elementWidth(editable)
		};
	}

	function end(event, boundaries, focus) {
		var box = lineBox(boundaries[1], event.editable.elem);
		var range = Ranges.fromPosition(
			// Because -1 ensures that the position is within the viewport
			box.right - 1,
			box.top,
			Boundaries.document(boundaries[0])
		);
		if (range) {
			var start = boundaries['start' === focus ? 1 : 0];
			boundaries = Events.hasKeyModifier(event, 'shift')
			           ? [start, Boundaries.fromRangeEnd(range)]
			           : Boundaries.fromRange(range);
			focus = 'end';
		}
		return {
			boundaries : boundaries,
			focus      : focus
		};
	}

	function home(event, boundaries, focus) {
		var box = lineBox(boundaries[0], event.editable.elem);
		var range = Ranges.fromPosition(
			box.left,
			box.top,
			Boundaries.document(boundaries[0])
		);
		if (range) {
			var end = boundaries['end' === focus ? 0 : 1];
			boundaries = Events.hasKeyModifier(event, 'shift')
			           ? [Boundaries.fromRangeStart(range), end]
			           : Boundaries.fromRange(range);
			focus = 'start';
		}
		return {
			boundaries : boundaries,
			focus      : focus
		};
	}

	/**
	 * Caret movement operations mapped against cursor key keycodes.
	 *
	 * @private
	 * @type {Object.<string, function(Event, Array.<Boundary>, string):Object>}
	 */
	var movements = {};

	movements['left'] =
	movements['*+left'] = Fn.partial(step, 'left');

	movements['right'] =
	movements['*+right'] = Fn.partial(step, 'right');

	movements['up'] =
	movements['*+up'] = Fn.partial(climb, 'up');

	movements['down'] =
	movements['*+down'] = Fn.partial(climb, 'down');

	movements['pageUp'] =
	movements['meta+up'] = Fn.partial(jump, 'up');

	movements['pageDown'] =
	movements['meta+down'] = Fn.partial(jump, 'down');

	movements['home'] =
	movements['meta+left'] =
	movements['meta+shift+left'] = home;

	movements['end'] =
	movements['meta+right'] =
	movements['meta+shift+right'] = end;

	/**
	 * Processes a keypress event.
	 *
	 * @private
	 * @param  {Event}            event
	 * @param  {Array.<Boundary>} range
	 * @param  {string}           focus
	 * @return {Object}
	 */
	function keypress(event, boundaries, focus) {
		return {
			boundaries : boundaries,
			focus      : focus
		};
	}

	/**
	 * Processes a keydown event.
	 *
	 * @private
	 * @param  {AlohaEvent}            event
	 * @param  {Array.<Boundary>} boundaries
	 * @param  {string}           focus
	 * @return {Object}
	 */
	function keydown(event, boundaries, focus) {
		var handler = Keys.shortcutHandler(event.meta, event.keycode, movements);
		if (handler) {
			Events.preventDefault(event.nativeEvent);
			return handler(event, boundaries, focus);
		}
		return keypress(event, boundaries, focus);
	}

	/**
	 * Processes a double-click event.
	 *
	 * @private
	 * @param  {Event}            event
	 * @param  {Array.<Boundary>} boundaries
	 * @return {Object}
	 */
	function dblclick(event, boundaries) {
		return {
			boundaries : Traversing.expand(boundaries[0], boundaries[1], 'word'),
			focus      : 'end'
		};
	}

	/**
	 * Processes a triple-click event.
	 *
	 * @private
	 * @param  {Event}            event
	 * @param  {Array.<Boundary>} boundaries
	 * @return {Object}
	 */
	function tplclick(event, boundaries) {
		return {
			boundaries : Traversing.expand(boundaries[0], boundaries[1], 'block'),
			focus      : 'end'
		};
	}

	/**
	 * Processes a mouseup event.
	 *
	 * @private
	 * @param  {Event}            event
	 * @param  {Array.<Boundary>} boundaries
	 * @param  {string}           focus
	 * @return {Object}
	 */
	function mouseup(event, boundaries, focus, previous, expanding) {
		return mergeRanges(boundaries, previous, focus);
	}

	/**
	 * Processes a mousedown event.
	 *
	 * @private
	 * @param  {Event}            event
	 * @param  {Array.<Boundary>} boundaries
	 * @param  {string}           focus
	 * @param  {Array.<Boundary>} previous
	 * @param  {boolean}          expanding
	 * @return {Object}
	 */
	function mousedown(event, boundaries, focus, previous, expanding) {
		if (!expanding) {
			return {
				boundaries : boundaries,
				focus      : focus
			};
		}
		var start = boundaries[0];
		var end = previous['start' === focus ? 1 : 0];
		if (isReversed(start, end)) {
			return {
				boundaries : [end, start],
				focus      : 'end'
			};
		}
		return {
			boundaries : [start, end],
			focus      : 'start'
		};
	}

	function dragndrop(event, boundaries) {
		return {
			boundaries : boundaries,
			focus      : 'end'
		};
	}

	function resize(event, boundaries, focus) {
		return {
			boundaries : boundaries,
			focus      : focus
		};
	}

	function paste(event, boundaries) {
		return {
			boundaries : boundaries,
			focus      : 'end'
		};
	}

	/**
	 * Event handlers.
	 *
	 * @private
	 * @type {Object.<string, function>}
	 */
	var handlers = {
		'keydown'        : keydown,
		'keypress'       : keypress,
		'aloha.dblclick' : dblclick,
		'aloha.tplclick' : tplclick,
		'aloha.mouseup'  : mouseup,
		'mouseup'        : mouseup,
		'mousedown'      : mousedown,
		'dragover'       : dragndrop,
		'drop'           : dragndrop,
		'resize'         : resize,
		'paste'          : paste
	};

	/**
	 * Initialize blinking using the given element.
	 *
	 * @private
	 * @param  {Element} caret
	 * @return {Object}
	 */
	function blinking(caret) {
		var timers = [];
		var isBlinking = true;
		function fade(start, end, duration) {
			Animation.animate(
				start,
				end,
				Animation.easeLinear,
				duration,
				function (value, percent, state) {
					if (!isBlinking) {
						return true;
					}
					Dom.setStyle(caret, 'opacity', value);
					if (percent < 1) {
						return;
					}
					if (0 === value) {
						timers.push(setTimeout(function () {
							fade(0, 1, 100);
						}, 300));
					} else if (1 === value){
						timers.push(setTimeout(function () {
							fade(1, 0, 100);
						}, 500));
					}
				}
			);
		}
		function stop() {
			isBlinking = false;
			Dom.setStyle(caret, 'opacity', 1);
			timers.forEach(clearTimeout);
			timers = [];
		}
		function blink() {
			stop();
			isBlinking = true;
			timers.push(setTimeout(function () {
				fade(1, 0, 100);
			}, 500));
		}
		function start() {
			stop();
			timers.push(setTimeout(blink, 50));
		}
		return {
			start : start,
			stop  : stop
		};
	}

	/**
	 * Creates a new selection context.
	 *
	 * Will create a DOM element at the end of the document body to be used to
	 * represent the caret position.
	 *
	 * @param  {Document} doc
	 * @return {Object}
	 * @memberOf selections
	 */
	function Context(doc) {
		var caret = doc.createElement('div');
		Maps.extend(caret.style, {
			'cursor'   : 'text',
			'color'    : '#000',
			'zIndex'   : '9999',
			'display'  : 'none',
			'position' : 'absolute'
		});
		Dom.addClass(caret, 'aloha-caret', 'aloha-ephemera');
		Dom.insert(caret, doc.body, true);
		return {
			blinking       : blinking(caret),
			focus          : 'end',
			boundaries     : null,
			event          : null,
			dragging       : null,
			multiclick     : null,
			clickTimer     : 0,
			lastMouseEvent : '',
			caret          : caret,
			formatting     : [],
			overrides      : []
		};
	}

	/**
	 * Ensures that the given boundary is visible inside of the viewport by
	 * scolling the view port if necessary.
	 *
	 * @param {!Boundary} boundary
	 * @memberOf selections
	 */
	function focus(boundary) {
		var box = Carets.box(Boundaries.range(boundary, boundary));
		var doc = Boundaries.document(boundary);
		var win = Dom.documentWindow(doc);
		var docOffset = docOffsets(doc);
		var top = docOffset.top;
		var left = docOffset.left;
		var height = win.innerHeight;
		var width = win.innerWidth;
		var buffer = box.height;
		var caretTop = box.top;
		var caretLeft = box.left;
		var correctTop = 0;
		var correctLeft = 0;
		if (caretTop < top) {
			// Because we want to caret to be near the top
			correctTop = caretTop - buffer;
		} else if (caretTop > top + height) {
			// Because we want to caret to be near the bottom
			correctTop = caretTop - height + buffer + buffer;
		}
		if (caretLeft < left) {
			// Because we want to caret to be near the left
			correctLeft = caretLeft - buffer;
		} else if (caretLeft > left + width) {
			// Because we want to caret to be near the right
			correctLeft = caretLeft - width + buffer + buffer;
		}
		if (correctTop || correctLeft) {
			win.scrollTo(correctLeft || left, correctTop || top);
		}
	}

	/**
	 * Computes a table of the given override and those collected at the given
	 * node.
	 *
	 * An object with overrides mapped against their names
	 *
	 * @private
	 * @param  {Node}      node
	 * @param  {Selection} selectoin
	 * @return {Object}
	 */
	function mapOverrides(node, selection) {
		var overrides = Overrides.joinToSet(
			selection.formatting,
			Overrides.harvest(node),
			selection.overrides
		);
		var map = Maps.merge(Maps.mapTuples(overrides));
		if (!map['color']) {
			map['color'] = Dom.getComputedStyle(
				Dom.isTextNode(node) ? node.parentNode : node,
				'color'
			);
		}
		return map;
	}

	function drawBox(box, doc) {
		var elem = doc.createElement('div');
		Maps.extend(elem.style, {
			'top'        : box.top + 'px',
			'left'       : box.left + 'px',
			'height'     : box.height + 'px',
			'width'      : box.width + 'px',
			'position'   : 'absolute',
			'background' : 'red',
			'opacity'    : 0.4
		});
		Dom.addClass(elem, 'aloha-selection-box', 'aloha-ephemera');
		Dom.append(elem, doc.body);
		return elem;
	}

	/**
	 * Updates selection
	 *
	 * @param  {AlohaEvent} event
	 * @return {AlohaEvent}
	 * @memberOf selections
	 */
	function handleSelections(event) {
		if (!handlers[event.type]) {
			return event;
		}
		var selection = event.selection;
		var change = handlers[event.type](
			event,
			selection.boundaries,
			selection.focus,
			selection.previousBoundaries,
			Events.hasKeyModifier(event, 'shift')
		);
		selection.focus = change.focus;
		selection.boundaries = change.boundaries;
		/*
		highlight(selection.boundaries[0], selection.boundaries[1]).forEach(function (box) {
			Dom.setStyle(box, 'background', '#fce05e'); // or blue #a6c7f7
		});
		*/
		return event;
	}

	/**
	 * Whether the given event will cause the position of the selection to move.
	 *
	 * @private
	 * @param  {Event} event
	 * @return {boolean}
	 */
	function isCaretMovingEvent(event) {
		if ('keypress' === event.type) {
			return true;
		}
		if ('paste' === event.type) {
			return true;
		}
		if (Keys.ARROWS[event.keycode]) {
			return true;
		}
		if (Keys.CODES['pageDown'] === event.keycode || Keys.CODES['pageUp'] === event.keycode) {
			return true;
		}
		if (Keys.CODES['undo'] === event.keycode) {
			if ('meta' === event.meta || 'ctrl' === event.meta || 'shift' === event.meta) {
				return true;
			}
		}
		if (Keys.CODES['enter'] === event.keycode) {
			return true;
		}
		return false;
	}

	/**
	 * Causes the selection for the given event to be set to the browser and the
	 * caret position to be visualized.
	 *
	 * @param  {!Event} event
	 * @return {?Selection}
	 */
	function update(event) {
		var selection = event.selection;
		if (event.preventSelection || selection.dragging) {
			return;
		}
		var type = event.type;
		if ('mouseup' === type || 'click' === type || 'dblclick' === type) {
			Dom.setStyle(selection.caret, 'display', 'block');
			return;
		}
		selection = select(
			selection,
			selection.boundaries[0],
			selection.boundaries[1],
			selection.focus
		);
		var boundary = selection.focus === 'start' ? selection.boundaries[0] : selection.boundaries[1];
		// Because we don't want the screen to jump when the editor hits "shift"
		if (isCaretMovingEvent(event)) {
			focus(boundary);
		}
		return selection;
	}

	/**
	 * Selects the given boundaries and visualizes the caret position.
	 *
	 * Returns the updated Selection object, that can be reassigned to
	 * aloha.editor.selection
	 *
	 * @param  {Selection} selection
	 * @param  {Boundary}  start
	 * @param  {Boundary}  end
	 * @param  {string=}   focus optional. "start" or "end". Defaults to "end"
	 * @return {Selection}
	 * @memberOf selections
	 */
	function select(selection, start, end, focus) {
		var boundary = 'start' === focus ? start : end;
		var node = Boundaries.container(boundary);
		if (!Dom.isEditableNode(node)) {
			Dom.setStyle(selection.caret, 'display', 'none');
			return boundary;
		}
		show(selection.caret, boundary);
		Maps.extend(
			selection.caret.style,
			stylesFromOverrides(mapOverrides(node, selection))
		);
		Boundaries.select(start, end);
		selection.blinking.start();
		return Maps.merge(selection, { 
			boundaries : [start, end],
			focus      : focus
		});
	}

	/**
	 * returns true if obj is a selection as returned by Context()
	 *
	 * @param  {*} obj
	 * @return {boolean}
	 * @memberOf selections
	 */
	function is(obj) {
		if (obj &&
			obj.hasOwnPropery &&
			obj.hasOwnProperty('focus') &&
			obj.hasOwnProperty('caret') &&
			obj.hasOwnProperty('boundaries')) {
			return true;
		}
		return false;
	}

	/**
	 * @see {ranges.is}
	 * @memberOf selections
	 */
	function isRange(obj) {
		return Ranges.is(obj);
	}

	return {
		is               : is,
		isRange          : isRange,
		show             : show,
		select           : select,
		focus            : focus,
		update           : update,
		handleSelections : handleSelections,
		Context          : Context,
		hideCarets       : hideCarets,
		unhideCarets     : unhideCarets,
		highlight        : highlight,
		selectionBoxes   : selectionBoxes
	};
});
