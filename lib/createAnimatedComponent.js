import React from 'react';
import { findNodeHandle, Platform, StyleSheet } from 'react-native';
import ReanimatedEventEmitter from './ReanimatedEventEmitter';
// @ts-ignore JS file
import AnimatedEvent from './reanimated1/core/AnimatedEvent';
// @ts-ignore JS file
import AnimatedNode from './reanimated1/core/AnimatedNode';
// @ts-ignore JS file
import AnimatedValue from './reanimated1/core/AnimatedValue';
// @ts-ignore JS file
import { createOrReusePropsNode } from './reanimated1/core/AnimatedProps';
import WorkletEventHandler from './reanimated2/WorkletEventHandler';
import setAndForwardRef from './setAndForwardRef';
import './reanimated2/layoutReanimation/LayoutAnimationRepository';
import invariant from 'invariant';
import { adaptViewConfig } from './ConfigHelper';
import { RNRenderer } from './reanimated2/platform-specific/RNRenderer';
import { makeMutable, runOnUI, enableLayoutAnimations, } from './reanimated2/core';
import { DefaultEntering, DefaultExiting, DefaultLayout, } from './reanimated2/layoutReanimation/defaultAnimations/Default';
import { isJest, isChromeDebugger, shouldBeUseWeb, } from './reanimated2/PlatformChecker';
import { initialUpdaterRun } from './reanimated2/animation';
const NODE_MAPPING = new Map();
function listener(data) {
    const component = NODE_MAPPING.get(data.viewTag);
    component && component._updateFromNative(data.props);
}
function dummyListener() {
    // empty listener we use to assign to listener properties for which animated
    // event is used.
}
function hasAnimatedNodes(value) {
    if (value instanceof AnimatedNode) {
        return true;
    }
    if (Array.isArray(value)) {
        return value.some((item) => hasAnimatedNodes(item));
    }
    if (value && typeof value === 'object') {
        return Object.keys(value).some((key) => hasAnimatedNodes(value[key]));
    }
    return false;
}
function flattenArray(array) {
    if (!Array.isArray(array)) {
        return [array];
    }
    const resultArr = [];
    const _flattenArray = (arr) => {
        arr.forEach((item) => {
            if (Array.isArray(item)) {
                _flattenArray(item);
            }
            else {
                resultArr.push(item);
            }
        });
    };
    _flattenArray(array);
    return resultArr;
}
function onlyAnimatedStyles(styles) {
    return styles.filter((style) => style === null || style === void 0 ? void 0 : style.viewDescriptors);
}
function isSameAnimatedStyle(style1, style2) {
    // We cannot use equality check to compare useAnimatedStyle outputs directly.
    // Instead, we can compare its viewsRefs.
    return (style1 === null || style1 === void 0 ? void 0 : style1.viewsRef) === (style2 === null || style2 === void 0 ? void 0 : style2.viewsRef);
}
const isSameAnimatedProps = isSameAnimatedStyle;
const has = (key, x) => {
    if (typeof x === 'function' || typeof x === 'object') {
        if (x === null || x === undefined) {
            return false;
        }
        else {
            return key in x;
        }
    }
    return false;
};
export default function createAnimatedComponent(Component, options) {
    invariant(typeof Component !== 'function' ||
        (Component.prototype && Component.prototype.isReactComponent), '`createAnimatedComponent` does not support stateless functional components; ' +
        'use a class component instead.');
    class AnimatedComponent extends React.Component {
        constructor(props) {
            super(props);
            this._invokeAnimatedPropsCallbackOnMount = false;
            this._styles = null;
            this._viewTag = -1;
            this._isFirstRender = true;
            this.animatedStyle = { value: {} };
            this.initialStyle = {};
            this._component = null;
            // The system is best designed when setNativeProps is implemented. It is
            // able to avoid re-rendering and directly set the attributes that changed.
            // However, setNativeProps can only be implemented on native components
            // If you want to animate a composite component, you need to re-render it.
            // In this case, we have a fallback that uses forceUpdate.
            this._animatedPropsCallback = () => {
                if (this._component == null) {
                    // AnimatedProps is created in will-mount because it's used in render.
                    // But this callback may be invoked before mount in async mode,
                    // In which case we should defer the setNativeProps() call.
                    // React may throw away uncommitted work in async mode,
                    // So a deferred call won't always be invoked.
                    this._invokeAnimatedPropsCallbackOnMount = true;
                }
                else if (typeof this._component.setNativeProps !== 'function') {
                    this.forceUpdate();
                }
                else {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    this._component.setNativeProps(this._propsAnimated.__getValue());
                }
            };
            this._setComponentRef = setAndForwardRef({
                getForwardedRef: () => this.props.forwardedRef,
                setLocalRef: (ref) => {
                    // TODO update config
                    const tag = findNodeHandle(ref);
                    if (!shouldBeUseWeb() &&
                        (this.props.layout || this.props.entering || this.props.exiting) &&
                        tag != null) {
                        enableLayoutAnimations(true, false);
                        let layout = this.props.layout ? this.props.layout : DefaultLayout;
                        let entering = this.props.entering
                            ? this.props.entering
                            : DefaultEntering;
                        let exiting = this.props.exiting
                            ? this.props.exiting
                            : DefaultExiting;
                        if (has('build', layout)) {
                            layout = layout.build();
                        }
                        if (has('build', entering)) {
                            entering = entering.build();
                        }
                        if (has('build', exiting)) {
                            exiting = exiting.build();
                        }
                        const config = {
                            layout,
                            entering,
                            exiting,
                            sv: this.sv,
                        };
                        runOnUI(() => {
                            'worklet';
                            global.LayoutAnimationRepository.registerConfig(tag, config);
                        })();
                    }
                    if (ref !== this._component) {
                        this._component = ref;
                    }
                },
            });
            this._attachProps(this.props);
            if (isJest()) {
                this.animatedStyle = { value: {} };
            }
            this.sv = makeMutable({});
        }
        componentWillUnmount() {
            this._detachPropUpdater();
            this._propsAnimated && this._propsAnimated.__detach();
            this._detachNativeEvents();
            this._detachStyles();
            this.sv = null;
        }
        componentDidMount() {
            if (this._invokeAnimatedPropsCallbackOnMount) {
                this._invokeAnimatedPropsCallbackOnMount = false;
                this._animatedPropsCallback();
            }
            this._propsAnimated &&
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                this._propsAnimated.setNativeView(this._component);
            this._attachNativeEvents();
            this._attachPropUpdater();
            this._attachAnimatedStyles();
        }
        _getEventViewRef() {
            var _a;
            // Make sure to get the scrollable node for components that implement
            // `ScrollResponder.Mixin`.
            return ((_a = this._component) === null || _a === void 0 ? void 0 : _a.getScrollableNode) ? this._component.getScrollableNode()
                : this._component;
        }
        _attachNativeEvents() {
            const node = this._getEventViewRef();
            let viewTag = findNodeHandle((options === null || options === void 0 ? void 0 : options.setNativeProps) ? this : node);
            const componentName = Component.displayName || Component.name;
            if ((componentName === null || componentName === void 0 ? void 0 : componentName.endsWith('FlashList')) && this._component) {
                // @ts-ignore it's FlashList specific: https://github.com/Shopify/flash-list/blob/218f314e63806b4fe926741ef73f8b9cd6ebc7eb/src/FlashList.tsx#L815
                viewTag = findNodeHandle(this._component.getScrollableNode());
            }
            for (const key in this.props) {
                const prop = this.props[key];
                if (prop instanceof AnimatedEvent) {
                    prop.attachEvent(node, key);
                }
                else if (has('current', prop) &&
                    prop.current instanceof WorkletEventHandler) {
                    prop.current.registerForEvents(viewTag, key);
                }
            }
        }
        _detachNativeEvents() {
            const node = this._getEventViewRef();
            for (const key in this.props) {
                const prop = this.props[key];
                if (prop instanceof AnimatedEvent) {
                    prop.detachEvent(node, key);
                }
                else if (has('current', prop) &&
                    prop.current instanceof WorkletEventHandler) {
                    prop.current.unregisterFromEvents();
                }
            }
        }
        _detachStyles() {
            var _a;
            if (Platform.OS === 'web' && this._styles !== null) {
                for (const style of this._styles) {
                    if (style === null || style === void 0 ? void 0 : style.viewsRef) {
                        style.viewsRef.remove(this);
                    }
                }
            }
            else if (this._viewTag !== -1 && this._styles !== null) {
                for (const style of this._styles) {
                    style.viewDescriptors.remove(this._viewTag);
                }
                if ((_a = this.props.animatedProps) === null || _a === void 0 ? void 0 : _a.viewDescriptors) {
                    this.props.animatedProps.viewDescriptors.remove(this._viewTag);
                }
            }
        }
        _reattachNativeEvents(prevProps) {
            const node = this._getEventViewRef();
            const attached = new Set();
            const nextEvts = new Set();
            let viewTag;
            for (const key in this.props) {
                const prop = this.props[key];
                if (prop instanceof AnimatedEvent) {
                    nextEvts.add(prop.__nodeID);
                }
                else if (has('current', prop) &&
                    prop.current instanceof WorkletEventHandler) {
                    if (viewTag === undefined) {
                        viewTag = prop.current.viewTag;
                    }
                }
            }
            for (const key in prevProps) {
                const prop = this.props[key];
                if (prop instanceof AnimatedEvent) {
                    if (!nextEvts.has(prop.__nodeID)) {
                        // event was in prev props but not in current props, we detach
                        prop.detachEvent(node, key);
                    }
                    else {
                        // event was in prev and is still in current props
                        attached.add(prop.__nodeID);
                    }
                }
                else if (has('current', prop) &&
                    prop.current instanceof WorkletEventHandler &&
                    prop.current.reattachNeeded) {
                    prop.current.unregisterFromEvents();
                }
            }
            for (const key in this.props) {
                const prop = this.props[key];
                if (prop instanceof AnimatedEvent &&
                    !attached.has(prop.__nodeID)) {
                    // not yet attached
                    prop.attachEvent(node, key);
                }
                else if (has('current', prop) &&
                    prop.current instanceof WorkletEventHandler &&
                    prop.current.reattachNeeded) {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    prop.current.registerForEvents(viewTag, key);
                    prop.current.reattachNeeded = false;
                }
            }
        }
        _attachProps(nextProps) {
            const oldPropsAnimated = this._propsAnimated;
            this._propsAnimated = createOrReusePropsNode(nextProps, this._animatedPropsCallback, oldPropsAnimated);
            // If prop node has been reused we don't need to call into "__detach"
            if (oldPropsAnimated !== this._propsAnimated) {
                // When you call detach, it removes the element from the parent list
                // of children. If it goes to 0, then the parent also detaches itself
                // and so on.
                // An optimization is to attach the new elements and THEN detach the old
                // ones instead of detaching and THEN attaching.
                // This way the intermediate state isn't to go to 0 and trigger
                // this expensive recursive detaching to then re-attach everything on
                // the very next operation.
                oldPropsAnimated && oldPropsAnimated.__detach();
            }
        }
        _updateFromNative(props) {
            var _a, _b;
            if (options === null || options === void 0 ? void 0 : options.setNativeProps) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                options.setNativeProps(this._component, props);
            }
            else {
                // eslint-disable-next-line no-unused-expressions
                (_b = (_a = this._component) === null || _a === void 0 ? void 0 : _a.setNativeProps) === null || _b === void 0 ? void 0 : _b.call(_a, props);
            }
        }
        _attachPropUpdater() {
            const viewTag = findNodeHandle(this);
            NODE_MAPPING.set(viewTag, this);
            if (NODE_MAPPING.size === 1) {
                ReanimatedEventEmitter.addListener('onReanimatedPropsChange', listener);
            }
        }
        _attachAnimatedStyles() {
            var _a, _b, _c;
            const styles = this.props.style
                ? onlyAnimatedStyles(flattenArray(this.props.style))
                : [];
            const prevStyles = this._styles;
            this._styles = styles;
            const prevAnimatedProps = this._animatedProps;
            this._animatedProps = this.props.animatedProps;
            let viewTag;
            let viewName;
            if (Platform.OS === 'web') {
                viewTag = findNodeHandle(this);
                viewName = null;
            }
            else {
                // hostInstance can be null for a component that doesn't render anything (render function returns null). Example: svg Stop: https://github.com/react-native-svg/react-native-svg/blob/develop/src/elements/Stop.tsx
                const hostInstance = RNRenderer.findHostInstance_DEPRECATED(this);
                if (!hostInstance) {
                    throw new Error('Cannot find host instance for this component. Maybe it renders nothing?');
                }
                // we can access view tag in the same way it's accessed here https://github.com/facebook/react/blob/e3f4eb7272d4ca0ee49f27577156b57eeb07cf73/packages/react-native-renderer/src/ReactFabric.js#L146
                viewTag = hostInstance === null || hostInstance === void 0 ? void 0 : hostInstance._nativeTag;
                /**
                 * RN uses viewConfig for components for storing different properties of the component(example: https://github.com/facebook/react-native/blob/master/Libraries/Components/ScrollView/ScrollViewViewConfig.js#L16).
                 * The name we're looking for is in the field named uiViewClassName.
                 */
                viewName = (_a = hostInstance === null || hostInstance === void 0 ? void 0 : hostInstance.viewConfig) === null || _a === void 0 ? void 0 : _a.uiViewClassName;
                // update UI props whitelist for this view
                const hasReanimated2Props = ((_b = this.props.animatedProps) === null || _b === void 0 ? void 0 : _b.viewDescriptors) || styles.length;
                if (hasReanimated2Props && (hostInstance === null || hostInstance === void 0 ? void 0 : hostInstance.viewConfig)) {
                    adaptViewConfig(hostInstance.viewConfig);
                }
            }
            this._viewTag = viewTag;
            // remove old styles
            if (prevStyles) {
                // in most of the cases, views have only a single animated style and it remains unchanged
                const hasOneSameStyle = styles.length === 1 &&
                    prevStyles.length === 1 &&
                    isSameAnimatedStyle(styles[0], prevStyles[0]);
                if (!hasOneSameStyle) {
                    // otherwise, remove each style that is not present in new styles
                    for (const prevStyle of prevStyles) {
                        const isPresent = styles.some((style) => isSameAnimatedStyle(style, prevStyle));
                        if (!isPresent) {
                            prevStyle.viewDescriptors.remove(viewTag);
                        }
                    }
                }
            }
            styles.forEach((style) => {
                style.viewDescriptors.add({ tag: viewTag, name: viewName });
                if (isJest()) {
                    /**
                     * We need to connect Jest's TestObject instance whose contains just props object
                     * with the updateProps() function where we update the properties of the component.
                     * We can't update props object directly because TestObject contains a copy of props - look at render function:
                     * const props = this._filterNonAnimatedProps(this.props);
                     */
                    this.animatedStyle.value = Object.assign(Object.assign({}, this.animatedStyle.value), style.initial.value);
                    style.animatedStyle.current = this.animatedStyle;
                }
            });
            // detach old animatedProps
            if (prevAnimatedProps &&
                !isSameAnimatedProps(prevAnimatedProps, this.props.animatedProps)) {
                prevAnimatedProps.viewDescriptors.remove(viewTag);
            }
            // attach animatedProps property
            if ((_c = this.props.animatedProps) === null || _c === void 0 ? void 0 : _c.viewDescriptors) {
                this.props.animatedProps.viewDescriptors.add({
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    tag: viewTag,
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    name: viewName,
                });
            }
        }
        _detachPropUpdater() {
            const viewTag = findNodeHandle(this);
            NODE_MAPPING.delete(viewTag);
            if (NODE_MAPPING.size === 0) {
                ReanimatedEventEmitter.removeAllListeners('onReanimatedPropsChange');
            }
        }
        componentDidUpdate(prevProps) {
            this._attachProps(this.props);
            this._reattachNativeEvents(prevProps);
            this._propsAnimated &&
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                this._propsAnimated.setNativeView(this._component);
            this._attachAnimatedStyles();
        }
        _filterNonAnimatedStyle(inputStyle) {
            const style = {};
            for (const key in inputStyle) {
                const value = inputStyle[key];
                if (!hasAnimatedNodes(value)) {
                    style[key] = value;
                }
                else if (value instanceof AnimatedValue) {
                    // if any style in animated component is set directly to the `Value` we set those styles to the first value of `Value` node in order
                    // to avoid flash of default styles when `Value` is being asynchrounously sent via bridge and initialized in the native side.
                    style[key] = value._startingValue;
                }
            }
            return style;
        }
        _filterNonAnimatedProps(inputProps) {
            const props = {};
            for (const key in inputProps) {
                const value = inputProps[key];
                if (key === 'style') {
                    const styleProp = inputProps.style;
                    const styles = flattenArray(styleProp !== null && styleProp !== void 0 ? styleProp : []);
                    const processedStyle = styles.map((style) => {
                        if (style && style.viewDescriptors) {
                            // this is how we recognize styles returned by useAnimatedStyle
                            style.viewsRef.add(this);
                            if (this._isFirstRender) {
                                this.initialStyle = Object.assign(Object.assign({}, style.initial.value), initialUpdaterRun(style.initial.updater));
                            }
                            return this.initialStyle;
                        }
                        else {
                            return style;
                        }
                    });
                    props[key] = this._filterNonAnimatedStyle(StyleSheet.flatten(processedStyle));
                }
                else if (key === 'animatedProps') {
                    const animatedProp = inputProps.animatedProps;
                    if (animatedProp.initial !== undefined) {
                        Object.keys(animatedProp.initial.value).forEach((key) => {
                            var _a, _b;
                            props[key] = (_a = animatedProp.initial) === null || _a === void 0 ? void 0 : _a.value[key];
                            (_b = animatedProp.viewsRef) === null || _b === void 0 ? void 0 : _b.add(this);
                        });
                    }
                }
                else if (value instanceof AnimatedEvent) {
                    // we cannot filter out event listeners completely as some components
                    // rely on having a callback registered in order to generate events
                    // alltogether. Therefore we provide a dummy callback here to allow
                    // native event dispatcher to hijack events.
                    props[key] = dummyListener;
                }
                else if (has('current', value) &&
                    value.current instanceof WorkletEventHandler) {
                    if (value.current.eventNames.length > 0) {
                        value.current.eventNames.forEach((eventName) => {
                            props[eventName] = has('listeners', value.current)
                                ? value.current.listeners[eventName]
                                : dummyListener;
                        });
                    }
                    else {
                        props[key] = dummyListener;
                    }
                }
                else if (!(value instanceof AnimatedNode)) {
                    if (key !== 'onGestureHandlerStateChange' || !isChromeDebugger()) {
                        props[key] = value;
                    }
                }
                else if (value instanceof AnimatedValue) {
                    // if any prop in animated component is set directly to the `Value` we set those props to the first value of `Value` node in order
                    // to avoid default values for a short moment when `Value` is being asynchrounously sent via bridge and initialized in the native side.
                    props[key] = value._startingValue;
                }
            }
            return props;
        }
        render() {
            const props = this._filterNonAnimatedProps(this.props);
            if (isJest()) {
                props.animatedStyle = this.animatedStyle;
            }
            if (this._isFirstRender) {
                this._isFirstRender = false;
            }
            const platformProps = Platform.select({
                web: {},
                default: { collapsable: false },
            });
            return (<Component {...props} ref={this._setComponentRef} {...platformProps}/>);
        }
    }
    AnimatedComponent.displayName = `AnimatedComponent(${Component.displayName || Component.name || 'Component'})`;
    return React.forwardRef((props, ref) => {
        return (<AnimatedComponent {...props} {...(ref === null ? null : { forwardedRef: ref })}/>);
    });
}
