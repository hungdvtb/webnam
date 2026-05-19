import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import ReactQuill from 'react-quill-new';
import { blogApi, aiApi, cmsApi, mediaApi } from '../../services/api';
import BlogInlineImageModal from '../../components/admin/BlogInlineImageModal';
import BlogMediaGalleryModal from '../../components/admin/BlogMediaGalleryModal';
import BlogPostBulkPasteModal from '../../components/admin/BlogPostBulkPasteModal';
import ProductDescriptionHtmlPasteModal from '../../components/admin/ProductDescriptionHtmlPasteModal';
import { useUI } from '../../context/UIContext';
import useAiAvailability from '../../hooks/useAiAvailability';
import {
    readInlineImageAttributes,
    registerBlogInlineImageBlot,
} from '../../utils/blogInlineImage';
import {
    GALLERY_BLOCK_CLASS,
    readGalleryItemsFromNode,
    registerBlogMediaGalleryBlot,
    renderBlogMediaGalleryNode,
} from '../../utils/blogMediaGallery';
import { resolveMediaUrl } from '../../utils/mediaUrl';
import { buildPublicBlogUrl } from '../../utils/publicSiteLinks';
import 'react-quill-new/dist/quill.snow.css';

const Quill = ReactQuill.Quill;
const Delta = Quill.import('delta');
registerBlogInlineImageBlot(Quill);
registerBlogMediaGalleryBlot(Quill);

const MEDIA_GALLERY_ACTION_ATTRIBUTE = 'data-media-gallery-action';
const MEDIA_GALLERY_DRAG_MIME = 'application/x-bdt-media-gallery';

const QUILL_FORMATS = [
    'header',
    'bold', 'italic', 'underline', 'strike', 'blockquote',
    'list', 'indent',
    'link', 'image', 'video', 'mediaGallery',
    'alt', 'title',
];

const BlogForm = () => {
    const { id } = useParams();
    const isEdit = !!id;
    const navigate = useNavigate();
    const { showModal, showToast } = useUI();
    const { available: aiAvailable, disabledReason } = useAiAvailability();
    const quillRef = useRef(null);
    const openMediaModalRef = useRef(() => {});
    const quillModulesRef = useRef(null);
    const draggedMediaGalleryRef = useRef(null);
    const dragOverMediaGalleryRef = useRef(null);

    const [loading, setLoading] = useState(false);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [uploadingFeaturedImage, setUploadingFeaturedImage] = useState(false);
    const [contentHtmlPasteOpen, setContentHtmlPasteOpen] = useState(false);
    const [bulkPasteOpen, setBulkPasteOpen] = useState(false);
    const [categories, setCategories] = useState([]);
    const [domains, setDomains] = useState([]);
    const [mediaModalState, setMediaModalState] = useState({
        open: false,
        items: [],
        insertIndex: null,
        editing: false,
    });
    const [inlineImageModalState, setInlineImageModalState] = useState({
        open: false,
        image: { src: '', alt: '', title: '' },
        insertIndex: null,
        editing: false,
    });
    const [formData, setFormData] = useState({
        title: '',
        slug: '',
        blog_category_id: '',
        seo_keyword: '',
        excerpt: '',
        meta_title: '',
        meta_description: '',
        meta_keywords: '',
        content: '',
        featured_image: '',
        is_ai_generated: false,
        is_published: true,
        is_starred: false,
        published_at: '',
        is_system: false,
        public_path: '',
        public_url: '',
    });

    const getQuillEditor = () => {
        try {
            return typeof quillRef.current?.getEditor === 'function'
                ? quillRef.current.getEditor()
                : null;
        } catch {
            return null;
        }
    };

    const normalizeMediaGalleryHtmlForStorage = (html) => {
        if (typeof document === 'undefined' || !html || !String(html).includes(GALLERY_BLOCK_CLASS)) {
            return html || '';
        }

        const template = document.createElement('template');
        template.innerHTML = String(html || '');
        template.content.querySelectorAll(`.${GALLERY_BLOCK_CLASS}`).forEach((node) => {
            renderBlogMediaGalleryNode(node, readGalleryItemsFromNode(node), { interactive: false });
        });

        return template.innerHTML;
    };

    const serializeEditorContent = (editorInstance) => {
        if (editorInstance?.root?.innerHTML) {
            return normalizeMediaGalleryHtmlForStorage(editorInstance.root.innerHTML);
        }

        if (typeof editorInstance?.getHTML === 'function') {
            return normalizeMediaGalleryHtmlForStorage(editorInstance.getHTML() || '');
        }

        try {
            const quill = getQuillEditor();
            return normalizeMediaGalleryHtmlForStorage(quill?.root?.innerHTML || '');
        } catch {
            return '';
        }
    };

    useEffect(() => {
        loadCategories();
        loadDomains();
        if (isEdit) {
            fetchPost();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    const loadCategories = async () => {
        try {
            const response = await blogApi.getCategories();
            setCategories(Array.isArray(response.data?.data) ? response.data.data : []);
        } catch (error) {
            console.error('Error loading categories', error);
        }
    };

    const loadDomains = async () => {
        try {
            const response = await cmsApi.domains.getAll();
            setDomains(Array.isArray(response.data) ? response.data : []);
        } catch (error) {
            console.error('Error loading domains', error);
        }
    };

    const fetchPost = async () => {
        setLoading(true);
        try {
            const response = await blogApi.getOne(id);
            const data = response.data;

            setFormData({
                title: data.title || '',
                slug: data.slug || '',
                blog_category_id: data.blog_category_id ? String(data.blog_category_id) : '',
                seo_keyword: data.seo_keyword || '',
                excerpt: data.excerpt || '',
                meta_title: data.meta_title || '',
                meta_description: data.meta_description || '',
                meta_keywords: data.meta_keywords || '',
                content: data.content || '',
                featured_image: data.featured_image || '',
                is_ai_generated: Boolean(data.is_ai_generated),
                is_published: data.is_published ?? true,
                is_starred: data.is_starred || false,
                published_at: data.published_at ? new Date(data.published_at).toISOString().split('T')[0] : '',
                is_system: Boolean(data.is_system),
                public_path: data.public_path || '',
                public_url: data.public_url || '',
            });
        } catch (error) {
            console.error('Error fetching post', error);
            showModal({ title: 'Lỗi', content: 'Không thể tải thông tin bài viết.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const publicPreviewUrl = useMemo(() => buildPublicBlogUrl(formData, { domains }), [domains, formData]);
    const featuredImagePreviewUrl = useMemo(
        () => resolveMediaUrl(formData.featured_image),
        [formData.featured_image],
    );
    const selectedCategory = useMemo(
        () => categories.find((category) => String(category.id) === String(formData.blog_category_id)) || null,
        [categories, formData.blog_category_id],
    );

    const openMediaModal = (options = {}) => {
        const quill = getQuillEditor();
        const range = quill?.getSelection(true);
        const fallbackIndex = typeof range?.index === 'number'
            ? range.index
            : Math.max((quill?.getLength() ?? 1) - 1, 0);

        setMediaModalState({
            open: true,
            items: Array.isArray(options.items) ? options.items : [],
            insertIndex: typeof options.index === 'number' ? options.index : fallbackIndex,
            editing: Boolean(options.editing),
        });
    };

    const openInlineImageModal = (options = {}) => {
        const quill = getQuillEditor();
        const range = quill?.getSelection(true);
        const fallbackIndex = typeof range?.index === 'number'
            ? range.index
            : Math.max((quill?.getLength() ?? 1) - 1, 0);

        setInlineImageModalState({
            open: true,
            image: {
                src: String(options.src || '').trim(),
                alt: String(options.alt || '').trim(),
                title: String(options.title || '').trim(),
            },
            insertIndex: typeof options.index === 'number' ? options.index : fallbackIndex,
            editing: Boolean(options.editing),
        });
    };

    openMediaModalRef.current = openMediaModal;

    if (!quillModulesRef.current) {
        quillModulesRef.current = {
            toolbar: {
                container: [
                    [{ header: [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike', 'blockquote'],
                    [{ list: 'ordered' }, { list: 'bullet' }, { indent: '-1' }, { indent: '+1' }],
                    ['link', 'image', 'video', 'mediaGallery'],
                    ['clean'],
                ],
                handlers: {
                    image: () => openInlineImageModal(),
                    mediaGallery: () => openMediaModalRef.current(),
                },
            },
            clipboard: {
                matchers: [
                    [`div.${GALLERY_BLOCK_CLASS}`, (node, delta) => {
                        const items = readGalleryItemsFromNode(node);

                        if (!items.length) {
                            return delta;
                        }

                        return new Delta()
                            .insert({ mediaGallery: items })
                            .insert('\n');
                    }],
                ],
            },
        };
    }

    const openExistingMediaGallery = (galleryNode) => {
        const quill = getQuillEditor();
        const root = quill?.root;

        if (!galleryNode || !quill || !root?.contains(galleryNode)) {
            return false;
        }

        const blot = Quill.find(galleryNode);
        const blotIndex = blot ? quill.getIndex(blot) : Math.max(quill.getLength() - 1, 0);

        quill.setSelection(blotIndex, 1, 'silent');
        openMediaModal({
            items: readGalleryItemsFromNode(galleryNode),
            index: blotIndex,
            editing: true,
        });

        return true;
    };

    const openExistingInlineImage = (imageNode) => {
        const quill = getQuillEditor();
        const root = quill?.root;

        if (!imageNode || !quill || !root?.contains(imageNode)) {
            return false;
        }

        const blot = Quill.find(imageNode);
        const blotIndex = blot ? quill.getIndex(blot) : Math.max(quill.getLength() - 1, 0);
        const imageAttributes = readInlineImageAttributes(imageNode);

        quill.setSelection(blotIndex, 1, 'silent');
        openInlineImageModal({
            ...imageAttributes,
            index: blotIndex,
            editing: true,
        });

        return true;
    };

    const getGalleryNodeFromEventTarget = (target) => {
        const eventElement = target instanceof Element ? target : target?.parentElement;
        return eventElement?.closest?.(`.${GALLERY_BLOCK_CLASS}`) || null;
    };

    const getInlineImageNodeFromEventTarget = (target) => {
        const eventElement = target instanceof Element ? target : target?.parentElement;

        if (!eventElement) {
            return null;
        }

        if (eventElement.closest?.(`.${GALLERY_BLOCK_CLASS}`)) {
            return null;
        }

        return eventElement.closest?.('img') || null;
    };

    const getGalleryActionElementFromEventTarget = (target) => {
        const eventElement = target instanceof Element ? target : target?.parentElement;
        return eventElement?.closest?.(`[${MEDIA_GALLERY_ACTION_ATTRIBUTE}]`) || null;
    };

    const getGalleryBlot = (galleryNode) => {
        try {
            return galleryNode ? Quill.find(galleryNode) : null;
        } catch {
            return null;
        }
    };

    const getBlotLength = (blot) => {
        try {
            const length = typeof blot?.length === 'function' ? blot.length() : 1;
            return Number.isFinite(length) && length > 0 ? length : 1;
        } catch {
            return 1;
        }
    };

    const getGalleryIndex = (galleryNode, quill) => {
        const blot = getGalleryBlot(galleryNode);
        if (!blot || !quill) {
            return -1;
        }

        try {
            return quill.getIndex(blot);
        } catch {
            return -1;
        }
    };

    const clearMediaGalleryDropIndicator = ({ keepRootActive = false } = {}) => {
        const quill = getQuillEditor();
        const root = quill?.root;

        root?.querySelectorAll('.ql-bdt-media-drop-before, .ql-bdt-media-drop-after').forEach((node) => {
            node.classList.remove('ql-bdt-media-drop-before', 'ql-bdt-media-drop-after');
        });

        if (!keepRootActive) {
            root?.classList.remove('ql-bdt-media-drag-active');
            draggedMediaGalleryRef.current?.classList?.remove('is-dragging');
            draggedMediaGalleryRef.current = null;
            dragOverMediaGalleryRef.current = null;
        }
    };

    const getMediaGalleryDropTargetFromEvent = (event) => {
        const quill = getQuillEditor();
        const root = quill?.root;

        if (!root) {
            return null;
        }

        const children = Array.from(root.children).filter((child) => child instanceof HTMLElement);

        if (!children.length) {
            return { targetNode: null, placement: 'after' };
        }

        const pointerY = event.clientY;
        let targetNode = children.find((child) => {
            const rect = child.getBoundingClientRect();
            return pointerY >= rect.top && pointerY <= rect.bottom;
        });

        if (!targetNode) {
            const firstNode = children[0];
            const lastNode = children[children.length - 1];
            targetNode = pointerY < firstNode.getBoundingClientRect().top ? firstNode : lastNode;
        }

        const rect = targetNode.getBoundingClientRect();
        const placement = pointerY < rect.top + (rect.height / 2) ? 'before' : 'after';

        return { targetNode, placement };
    };

    const showMediaGalleryDropIndicator = (dropTarget) => {
        const quill = getQuillEditor();
        const root = quill?.root;

        clearMediaGalleryDropIndicator({ keepRootActive: true });
        root?.classList.add('ql-bdt-media-drag-active');

        if (dropTarget?.targetNode) {
            dropTarget.targetNode.classList.add(
                dropTarget.placement === 'before'
                    ? 'ql-bdt-media-drop-before'
                    : 'ql-bdt-media-drop-after'
            );
        }
    };

    const getInsertionIndexForDropTarget = (dropTarget, quill) => {
        if (!quill) {
            return -1;
        }

        if (!dropTarget?.targetNode) {
            return Math.max(quill.getLength() - 1, 0);
        }

        const targetBlot = getGalleryBlot(dropTarget.targetNode);
        if (!targetBlot) {
            return Math.max(quill.getLength() - 1, 0);
        }

        const targetIndex = quill.getIndex(targetBlot);
        return dropTarget.placement === 'after'
            ? targetIndex + getBlotLength(targetBlot)
            : targetIndex;
    };

    const updateMediaGalleryCompactButton = (galleryNode, isCompact) => {
        const button = galleryNode?.querySelector?.(`[${MEDIA_GALLERY_ACTION_ATTRIBUTE}="toggle-compact"]`);
        const icon = button?.querySelector?.('.material-symbols-outlined');

        if (icon) {
            icon.textContent = isCompact ? 'unfold_more' : 'unfold_less';
        }

        button?.setAttribute('title', isCompact ? 'Mở rộng block media' : 'Thu gọn block media');
        button?.setAttribute('aria-label', isCompact ? 'Mở rộng block media' : 'Thu gọn block media');
    };

    const toggleMediaGalleryCompact = (galleryNode) => {
        if (!galleryNode) {
            return false;
        }

        const nextCompactState = !galleryNode.classList.contains('is-compact');
        galleryNode.classList.toggle('is-compact', nextCompactState);
        galleryNode.setAttribute('data-gallery-compact', nextCompactState ? 'true' : 'false');
        updateMediaGalleryCompactButton(galleryNode, nextCompactState);
        return true;
    };

    const moveMediaGalleryNode = (sourceNode, dropTarget) => {
        const quill = getQuillEditor();
        const root = quill?.root;

        if (!sourceNode || !quill || !root?.contains(sourceNode)) {
            return false;
        }

        const sourceBlot = getGalleryBlot(sourceNode);
        const sourceIndex = getGalleryIndex(sourceNode, quill);
        const sourceLength = getBlotLength(sourceBlot);
        const items = readGalleryItemsFromNode(sourceNode);
        let targetIndex = getInsertionIndexForDropTarget(dropTarget, quill);

        if (sourceIndex < 0 || targetIndex < 0 || !items.length) {
            return false;
        }

        if (targetIndex > sourceIndex) {
            targetIndex -= sourceLength;
        }

        targetIndex = Math.max(0, Math.min(targetIndex, Math.max(quill.getLength() - sourceLength, 0)));

        if (targetIndex === sourceIndex) {
            return false;
        }

        quill.deleteText(sourceIndex, sourceLength, 'user');
        targetIndex = Math.max(0, Math.min(targetIndex, Math.max(quill.getLength() - 1, 0)));
        quill.insertEmbed(targetIndex, 'mediaGallery', items, 'user');
        quill.setSelection(Math.min(targetIndex + 1, quill.getLength()), 0, 'silent');
        syncEditorContentToState(quill);
        return true;
    };

    const moveMediaGalleryByDirection = (galleryNode, direction) => {
        const quill = getQuillEditor();
        const root = quill?.root;

        if (!galleryNode || !root?.contains(galleryNode)) {
            return false;
        }

        const siblings = Array.from(root.children).filter((child) => child instanceof HTMLElement);
        const currentIndex = siblings.indexOf(galleryNode);
        const targetNode = direction < 0 ? siblings[currentIndex - 1] : siblings[currentIndex + 1];

        if (!targetNode) {
            showToast({
                message: direction < 0 ? 'Block media đang ở đầu nội dung.' : 'Block media đang ở cuối nội dung.',
                type: 'info',
                duration: 1200,
            });
            return false;
        }

        const moved = moveMediaGalleryNode(galleryNode, {
            targetNode,
            placement: direction < 0 ? 'before' : 'after',
        });

        if (moved) {
            showToast({
                message: direction < 0 ? 'Đã chuyển block media lên.' : 'Đã chuyển block media xuống.',
                type: 'success',
                duration: 1200,
            });
        }

        return moved;
    };

    const removeMediaGalleryNode = (galleryNode) => {
        const quill = getQuillEditor();
        const index = getGalleryIndex(galleryNode, quill);

        if (!quill || index < 0) {
            return false;
        }

        quill.deleteText(index, 1, 'user');
        syncEditorContentToState(quill);
        showToast({
            message: 'Đã xóa block media khỏi nội dung bài viết.',
            type: 'success',
        });
        return true;
    };

    const handleMediaGalleryAction = (action, galleryNode) => {
        if (!galleryNode) {
            return false;
        }

        switch (action) {
            case 'move-up':
                return moveMediaGalleryByDirection(galleryNode, -1);
            case 'move-down':
                return moveMediaGalleryByDirection(galleryNode, 1);
            case 'toggle-compact':
                return toggleMediaGalleryCompact(galleryNode);
            case 'edit':
                return openExistingMediaGallery(galleryNode);
            case 'delete':
                return removeMediaGalleryNode(galleryNode);
            case 'drag':
                return true;
            default:
                return false;
        }
    };

    const handleEditorClickCapture = (event) => {
        const actionElement = getGalleryActionElementFromEventTarget(event.target);
        if (actionElement) {
            const galleryNode = getGalleryNodeFromEventTarget(actionElement);
            const handled = handleMediaGalleryAction(actionElement.getAttribute(MEDIA_GALLERY_ACTION_ATTRIBUTE), galleryNode);

            if (handled) {
                event.preventDefault();
                event.stopPropagation();
            }

            return;
        }

        const galleryNode = getGalleryNodeFromEventTarget(event.target);

        if (openExistingMediaGallery(galleryNode)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        const imageNode = getInlineImageNodeFromEventTarget(event.target);

        if (openExistingInlineImage(imageNode)) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    const handleEditorKeyDownCapture = (event) => {
        if (!['Enter', ' '].includes(event.key)) {
            return;
        }

        if (getGalleryActionElementFromEventTarget(event.target)) {
            return;
        }

        const galleryNode = getGalleryNodeFromEventTarget(event.target);

        if (openExistingMediaGallery(galleryNode)) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        const imageNode = getInlineImageNodeFromEventTarget(event.target);

        if (openExistingInlineImage(imageNode)) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    const handleEditorDragStartCapture = (event) => {
        const actionElement = getGalleryActionElementFromEventTarget(event.target);

        if (actionElement?.getAttribute(MEDIA_GALLERY_ACTION_ATTRIBUTE) !== 'drag') {
            return;
        }

        const galleryNode = getGalleryNodeFromEventTarget(actionElement);

        if (!galleryNode) {
            return;
        }

        draggedMediaGalleryRef.current = galleryNode;
        galleryNode.classList.add('is-dragging');

        const quill = getQuillEditor();
        quill?.root?.classList.add('ql-bdt-media-drag-active');

        event.dataTransfer?.setData(MEDIA_GALLERY_DRAG_MIME, 'move');
        event.dataTransfer?.setData('text/plain', 'media-gallery');
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
        }

        event.stopPropagation();
    };

    const handleEditorDragOverCapture = (event) => {
        if (!draggedMediaGalleryRef.current) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
        }

        const dropTarget = getMediaGalleryDropTargetFromEvent(event);
        dragOverMediaGalleryRef.current = dropTarget;
        showMediaGalleryDropIndicator(dropTarget);
    };

    const handleEditorDropCapture = (event) => {
        const draggedNode = draggedMediaGalleryRef.current;

        if (!draggedNode) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const dropTarget = dragOverMediaGalleryRef.current || getMediaGalleryDropTargetFromEvent(event);
        const moved = moveMediaGalleryNode(draggedNode, dropTarget);
        clearMediaGalleryDropIndicator();

        if (moved) {
            showToast({
                message: 'Đã cập nhật vị trí block media.',
                type: 'success',
                duration: 1200,
            });
        }
    };

    const handleEditorDragEndCapture = () => {
        if (draggedMediaGalleryRef.current) {
            clearMediaGalleryDropIndicator();
        }
    };

    const closeMediaModal = () => {
        setMediaModalState((prev) => ({
            ...prev,
            open: false,
        }));
    };

    const closeInlineImageModal = () => {
        setInlineImageModalState((prev) => ({
            ...prev,
            open: false,
        }));
    };

    const handleSaveMediaGallery = (items) => {
        const quill = getQuillEditor();

        if (!quill) {
            showModal({
                title: 'Editor chưa sẵn sàng',
                content: 'Không thể cập nhật block media lúc này. Hãy tải lại trang rồi thử lại.',
                type: 'warning',
            });
            return;
        }

        const selection = quill.getSelection(true);
        let insertIndex = typeof mediaModalState.insertIndex === 'number'
            ? mediaModalState.insertIndex
            : Math.max(quill.getLength() - 1, 0);
        let deleteLength = 0;

        if (mediaModalState.editing) {
            deleteLength = 1;
        } else if (selection) {
            insertIndex = selection.index;
            deleteLength = Math.max(selection.length || 0, 0);
        }

        const delta = new Delta()
            .retain(insertIndex)
            .delete(deleteLength)
            .insert({ mediaGallery: items })
            .insert('\n');

        quill.updateContents(delta, 'user');
        quill.setSelection(Math.min(insertIndex + 2, quill.getLength()), 0, 'silent');
        syncEditorContentToState(quill);
        closeMediaModal();

        showToast({
            message: mediaModalState.editing
                ? 'Đã cập nhật block media trong nội dung bài viết.'
                : 'Đã chèn block media vào đúng vị trí con trỏ.',
            type: 'success',
        });
    };

    const handleRemoveMediaGallery = () => {
        const quill = getQuillEditor();

        if (!quill || typeof mediaModalState.insertIndex !== 'number') {
            closeMediaModal();
            return;
        }

        quill.updateContents(
            new Delta().retain(mediaModalState.insertIndex).delete(1),
            'user'
        );
        syncEditorContentToState(quill);
        closeMediaModal();

        showToast({
            message: 'Đã xóa block media khỏi nội dung bài viết.',
            type: 'success',
        });
    };

    const syncEditorContentToState = (editorInstance) => {
        const nextContent = serializeEditorContent(editorInstance);
        setFormData((prev) => (
            nextContent === prev.content
                ? prev
                : { ...prev, content: nextContent }
        ));
    };

    const handleSaveInlineImage = (image) => {
        const quill = getQuillEditor();

        if (!quill) {
            showModal({
                title: 'Editor chưa sẵn sàng',
                content: 'Không thể cập nhật ảnh trong bài viết lúc này. Hãy tải lại trang rồi thử lại.',
                type: 'warning',
            });
            return;
        }

        const selection = quill.getSelection(true);
        let insertIndex = typeof inlineImageModalState.insertIndex === 'number'
            ? inlineImageModalState.insertIndex
            : Math.max(quill.getLength() - 1, 0);
        let deleteLength = 0;

        if (inlineImageModalState.editing) {
            deleteLength = 1;
        } else if (selection) {
            insertIndex = selection.index;
            deleteLength = Math.max(selection.length || 0, 0);
        }

        if (deleteLength > 0) {
            quill.deleteText(insertIndex, deleteLength, 'user');
        }

        quill.insertEmbed(insertIndex, 'image', {
            src: image.src,
            alt: image.alt,
            title: image.title,
        }, 'user');
        quill.setSelection(Math.min(insertIndex + 1, quill.getLength()), 0, 'silent');

        syncEditorContentToState(quill);
        closeInlineImageModal();

        showToast({
            message: inlineImageModalState.editing
                ? 'Đã cập nhật ảnh trong nội dung bài viết.'
                : 'Đã chèn ảnh mới vào nội dung bài viết.',
            type: 'success',
        });
    };

    const handleRemoveInlineImage = () => {
        const quill = getQuillEditor();

        if (!quill || typeof inlineImageModalState.insertIndex !== 'number') {
            closeInlineImageModal();
            return;
        }

        quill.deleteText(inlineImageModalState.insertIndex, 1, 'user');
        syncEditorContentToState(quill);
        closeInlineImageModal();

        showToast({
            message: 'Đã xóa ảnh khỏi nội dung bài viết.',
            type: 'success',
        });
    };

    const handleChange = (event) => {
        const { name, value, type, checked } = event.target;
        setFormData((prev) => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const handleFeaturedImageUpload = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file) {
            return;
        }

        setUploadingFeaturedImage(true);

        try {
            const uploadData = new FormData();
            uploadData.append('image', file);

            const response = await mediaApi.upload(uploadData);
            const nextImageUrl = String(response?.data?.url || '').trim();

            if (!nextImageUrl) {
                throw new Error('UPLOAD_FAILED');
            }

            setFormData((prev) => ({
                ...prev,
                featured_image: nextImageUrl,
            }));

            showToast({
                message: 'Đã cập nhật ảnh đại diện mới.',
                type: 'success',
            });
        } catch {
            showModal({
                title: 'Upload ảnh đại diện thất bại',
                content: 'Không thể tải ảnh đại diện lên lúc này. Bạn có thể thử lại hoặc dán link ảnh trực tiếp.',
                type: 'error',
            });
        } finally {
            setUploadingFeaturedImage(false);
        }
    };

    const handleOpenOnWeb = () => {
        if (!publicPreviewUrl) {
            showModal({
                title: 'Khong mo duoc bai viet',
                content: 'Bai viet nay chua co URL frontend/public hop le. Hay kiem tra slug va domain website.',
                type: 'warning',
            });
            return;
        }

        window.open(publicPreviewUrl, '_blank', 'noopener,noreferrer');
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLoading(true);

        try {
            const payload = {
                title: formData.title,
                slug: formData.slug,
                blog_category_id: formData.blog_category_id ? Number(formData.blog_category_id) : null,
                seo_keyword: formData.seo_keyword,
                excerpt: formData.excerpt,
                meta_title: formData.meta_title,
                meta_description: formData.meta_description,
                meta_keywords: formData.meta_keywords,
                content: serializeEditorContent(getQuillEditor()) || formData.content,
                featured_image: formData.featured_image,
                is_ai_generated: Boolean(formData.is_ai_generated),
                is_published: formData.is_published,
                is_starred: formData.is_starred,
                published_at: formData.published_at || null,
            };

            if (isEdit) {
                await blogApi.update(id, payload);
                showModal({ title: 'Thành công', content: 'Đã cập nhật bài viết.', type: 'success' });
            } else {
                await blogApi.store(payload);
                showModal({ title: 'Thành công', content: 'Đã tạo bài viết mới.', type: 'success' });
            }

            navigate('/admin/blog');
        } catch (error) {
            console.error('Error saving post', error);
            showModal({ title: 'Lỗi', content: 'Không thể lưu bài viết. Vui lòng kiểm tra lại.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleAIGenerate = async () => {
        if (!aiAvailable) {
            showModal({ title: 'AI chưa sẵn sàng', content: disabledReason, type: 'warning' });
            return;
        }

        setAiGenerating(true);

        try {
            const prompt = [
                'Bạn là biên tập viên SEO tiếng Việt cho website bán hàng.',
                'Hãy tạo một bài viết blog mới và trả về DUY NHẤT JSON hợp lệ theo cấu trúc:',
                '{"title":"...","seo_keyword":"...","excerpt":"...","content":"..."}',
                'Yêu cầu bắt buộc:',
                '- title hấp dẫn, đúng chính tả, có giá trị SEO.',
                '- seo_keyword ngắn gọn, sát chủ đề bài.',
                '- excerpt dài 140-180 ký tự.',
                '- content là HTML hợp lệ với các thẻ p, h2, h3, ul, li, strong.',
                '- Nội dung khoảng 700-1000 từ, văn phong tự nhiên, bán hàng vừa phải, có giá trị thực tế.',
                '- Có mở bài, phần thân theo cụm ý rõ ràng, kết bài và lời kêu gọi hành động nhẹ.',
                '- Không nhắc rằng bạn là AI.',
                `Tiêu đề gợi ý hiện tại: ${formData.title || 'Chưa có, hãy tự đề xuất tiêu đề phù hợp.'}`,
                `Từ khóa SEO gợi ý: ${formData.seo_keyword || 'Chưa có, hãy tự đề xuất.'}`,
                `Tóm tắt hiện tại: ${formData.excerpt || 'Chưa có.'}`,
                `Danh mục bài viết: ${selectedCategory?.name || 'Chưa chọn danh mục'}`,
            ].join('\n');

            const response = await aiApi.generateContent({ prompt });

            let aiData;
            try {
                const raw = response.data?.text || response.data?.response || '{}';
                const jsonMatch = raw.match(/\{[\s\S]*\}/);
                aiData = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
            } catch {
                const fallback = response.data?.text || response.data?.response || '';
                aiData = {
                    title: formData.title || 'Bài viết mới',
                    seo_keyword: formData.seo_keyword || '',
                    excerpt: fallback.slice(0, 180),
                    content: `<p>${fallback}</p>`,
                };
            }

            setFormData((prev) => ({
                ...prev,
                title: aiData.title || prev.title,
                seo_keyword: aiData.seo_keyword || prev.seo_keyword,
                excerpt: aiData.excerpt || prev.excerpt,
                content: aiData.content || prev.content,
                is_ai_generated: true,
                is_published: true,
            }));

            showModal({ title: 'Thành công', content: 'AI đã tạo bản thảo bài viết.', type: 'success' });
        } catch {
            showModal({ title: 'Lỗi AI', content: 'Không thể kết nối AI lúc này.', type: 'error' });
        } finally {
            setAiGenerating(false);
        }
    };

    const getCurrentContentHtml = () => serializeEditorContent(getQuillEditor()) || formData.content || '';

    const extractJsonObjectFromText = (value) => {
        const normalized = String(value || '')
            .trim()
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

        if (!normalized) {
            throw new Error('EMPTY_JSON');
        }

        try {
            return JSON.parse(normalized);
        } catch {
            const startIndex = normalized.indexOf('{');
            const endIndex = normalized.lastIndexOf('}');

            if (startIndex < 0 || endIndex <= startIndex) {
                throw new Error('INVALID_JSON');
            }

            return JSON.parse(normalized.slice(startIndex, endIndex + 1));
        }
    };

    const buildFullPostPromptForChatGpt = () => {
        const payload = {
            title: formData.title || '',
            slug: formData.slug || '',
            category: {
                id: formData.blog_category_id || '',
                name: selectedCategory?.name || '',
            },
            seo_keyword: formData.seo_keyword || '',
            excerpt: formData.excerpt || '',
            meta_title: formData.meta_title || '',
            meta_description: formData.meta_description || '',
            meta_keywords: formData.meta_keywords || '',
            featured_image: formData.featured_image || '',
            content_html: getCurrentContentHtml(),
        };

        return [
            'Bạn là biên tập viên SEO tiếng Việt cho website bán hàng.',
            '',
            'Tôi sẽ gửi toàn bộ dữ liệu bài viết hiện tại ở dạng JSON.',
            'Yêu cầu:',
            '- Viết lại title, seo_keyword, excerpt, meta_title, meta_description, meta_keywords và content_html cho tự nhiên hơn, chuẩn SEO hơn.',
            '- Giữ nguyên slug, category và featured_image, chỉ dùng làm thông tin tham khảo.',
            '- content_html phải là HTML hoàn chỉnh.',
            '- Giữ nguyên ảnh, video, iframe, gallery, link và thuộc tính HTML đang có trong content_html.',
            '- Không tự bịa thông tin, giá, chính sách, cam kết hoặc thông số nếu dữ liệu không có.',
            '- Trả về DUY NHẤT JSON hợp lệ, không markdown, không giải thích.',
            '',
            'Schema JSON cần trả về:',
            JSON.stringify({
                title: '',
                seo_keyword: '',
                excerpt: '',
                meta_title: '',
                meta_description: '',
                meta_keywords: '',
                content_html: '',
            }, null, 2),
            '',
            'Dữ liệu hiện tại:',
            JSON.stringify(payload, null, 2),
        ].join('\n');
    };

    const handleCopyContentHtml = () => {
        const content = getCurrentContentHtml();
        if (!content || content === '<p><br></p>') {
            showToast({ message: 'Nội dung bài viết đang trống.', type: 'warning' });
            return;
        }

        navigator.clipboard.writeText(content).then(() => {
            showToast({ message: 'Đã sao chép HTML bài viết.', type: 'success' });
        }).catch(() => {
            showToast({ message: 'Không thể sao chép HTML lúc này.', type: 'error' });
        });
    };

    const handleApplyContentHtmlPaste = (html) => {
        let normalizedHtml = String(html || '').trim();
        normalizedHtml = normalizedHtml.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();

        if (!normalizedHtml) {
            showToast({ message: 'HTML đang trống.', type: 'warning' });
            return;
        }

        setFormData((prev) => ({
            ...prev,
            content: normalizedHtml,
        }));
        setContentHtmlPasteOpen(false);
        showToast({ message: 'Đã áp dụng HTML bài viết mới.', type: 'success' });
    };

    const handleCopyFullPostForChatGpt = () => {
        navigator.clipboard.writeText(buildFullPostPromptForChatGpt()).then(() => {
            showToast({ message: 'Đã sao chép toàn bộ dữ liệu bài viết.', type: 'success' });
        }).catch(() => {
            showToast({ message: 'Không thể sao chép dữ liệu lúc này.', type: 'error' });
        });
    };

    const handleApplyFullPostPaste = (value) => {
        let data;
        try {
            data = extractJsonObjectFromText(value);
        } catch {
            showToast({ message: 'JSON không hợp lệ. Hãy dán đúng JSON ChatGPT trả về.', type: 'error' });
            return;
        }

        const contentHtml = data.content_html ?? data.content ?? data.html;

        setFormData((prev) => ({
            ...prev,
            title: String(data.title ?? prev.title ?? ''),
            seo_keyword: String(data.seo_keyword ?? prev.seo_keyword ?? ''),
            excerpt: String(data.excerpt ?? prev.excerpt ?? ''),
            meta_title: String(data.meta_title ?? prev.meta_title ?? ''),
            meta_description: String(data.meta_description ?? prev.meta_description ?? ''),
            meta_keywords: Array.isArray(data.meta_keywords)
                ? data.meta_keywords.join(', ')
                : String(data.meta_keywords ?? prev.meta_keywords ?? ''),
            featured_image: String(data.featured_image ?? prev.featured_image ?? ''),
            content: contentHtml !== undefined ? String(contentHtml || '') : prev.content,
        }));
        setBulkPasteOpen(false);
        showToast({ message: 'Đã áp dụng toàn bộ dữ liệu bài viết.', type: 'success' });
    };

    return (
        <>
            <form onSubmit={handleSubmit} className="space-y-10 animate-fade-in pb-20">
                <div className="flex justify-between items-end gap-6 border-b border-gold/10 pb-8">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-2xl font-display font-bold text-primary italic uppercase tracking-wider">
                                {isEdit ? 'Cập Nhật Bài Viết' : 'Tạo Bài Viết Mới'}
                            </h1>
                            {formData.is_system && (
                                <span className="inline-flex items-center rounded-sm border border-primary/20 bg-primary/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                                    Bài hệ thống
                                </span>
                            )}
                        </div>
                        <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-stone/40">
                            {formData.is_system
                                ? 'Bài hệ thống luôn tồn tại, chỉ nên chỉnh phần nội dung hiển thị'
                                : 'Mặc định bài mới được hiển thị ngay trên website'}
                        </p>
                    </div>

                    <div className="flex gap-4">
                        <button
                            type="button"
                            onClick={handleCopyFullPostForChatGpt}
                            className="border border-gold/20 px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-gold transition-colors hover:bg-gold/5"
                            title="Copy toàn bộ title, SEO và HTML nội dung để sửa ngoài ChatGPT"
                        >
                            Copy tất cả
                        </button>
                        <button
                            type="button"
                            onClick={() => setBulkPasteOpen(true)}
                            className="border border-primary/20 px-6 py-3 text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary/5"
                            title="Dán JSON đã sửa từ ChatGPT để cập nhật một lượt"
                        >
                            Dán tất cả
                        </button>
                        {isEdit && (
                            <button
                                type="button"
                                onClick={handleOpenOnWeb}
                                className="border border-gold/20 px-8 py-3 text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary/5"
                            >
                                Xem ngoai web
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => navigate('/admin/blog')}
                            className="border border-stone/20 px-8 py-3 text-[10px] font-bold uppercase tracking-widest text-stone transition-colors hover:text-primary"
                        >
                            Hủy
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="bg-primary px-10 py-3 font-ui text-[10px] font-bold uppercase tracking-widest text-white shadow-premium transition-all hover:bg-umber disabled:opacity-50"
                        >
                            {loading ? 'Đang lưu...' : isEdit ? 'Cập Nhật' : 'Đăng Bài'}
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
                    <div className="space-y-8 lg:col-span-8">
                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tiêu Đề Bài Viết</label>
                            <input
                                type="text"
                                name="title"
                                value={formData.title}
                                onChange={handleChange}
                                required
                                disabled={formData.is_system}
                                className={`w-full border border-gold/20 p-5 font-display text-2xl text-primary shadow-sm ${formData.is_system ? 'cursor-not-allowed bg-stone/5 opacity-80' : 'bg-white focus:border-primary focus:outline-none'}`}
                                placeholder="VD: Bí quyết chọn gốm Bát Tràng"
                            />
                            {formData.is_system && (
                                <p className="text-[10px] italic text-stone/55">Tiêu đề bài hệ thống được giữ cố định để đồng bộ trang chính sách.</p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Slug</label>
                            <input
                                type="text"
                                name="slug"
                                value={formData.slug}
                                readOnly
                                className="w-full border border-gold/20 bg-stone/5 p-4 font-body text-sm text-stone/70 shadow-sm focus:outline-none"
                                placeholder="Slug sẽ được tạo tự động"
                            />
                            <p className="text-[10px] italic text-stone/55">Slug được tạo tự động. Với bài hệ thống, slug được cố định để hệ thống luôn nhận diện đúng bài.</p>
                        </div>

                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Danh Mục Bài Viết</label>
                            <select
                                name="blog_category_id"
                                value={formData.blog_category_id}
                                onChange={handleChange}
                                className="w-full border border-gold/20 bg-white p-4 font-body text-sm text-primary shadow-sm focus:border-primary focus:outline-none"
                            >
                                <option value="">Chưa gắn danh mục</option>
                                {categories.map((category) => (
                                    <option key={category.id} value={String(category.id)}>
                                        {category.name}
                                    </option>
                                ))}
                            </select>
                            <p className="text-[10px] italic text-stone/55">Danh mục này sẽ được sử dụng cho bộ lọc tab ngoài frontend.</p>
                        </div>

                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Từ Khóa SEO Chính</label>
                            <input
                                type="text"
                                name="seo_keyword"
                                value={formData.seo_keyword}
                                onChange={handleChange}
                                className="w-full border border-gold/20 bg-white p-4 font-body text-sm text-primary shadow-sm focus:border-primary focus:outline-none"
                                placeholder="VD: gốm bát tràng phòng khách"
                            />
                            <p className="text-[10px] italic text-stone/55">Mỗi bài nên gắn một từ khóa SEO chính để theo dõi kết quả.</p>
                        </div>

                        <div className="space-y-2">
                            <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Tóm Tắt Ngắn (Excerpt)</label>
                            <textarea
                                name="excerpt"
                                value={formData.excerpt}
                                onChange={handleChange}
                                rows="3"
                                className="w-full resize-none border border-gold/20 bg-white p-4 font-body text-sm italic text-umber shadow-sm focus:border-primary focus:outline-none"
                                placeholder="Đoạn mô tả ngắn để thu hút độc giả..."
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div className="space-y-2 md:col-span-3">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">SEO Title</label>
                                <input
                                    type="text"
                                    name="meta_title"
                                    value={formData.meta_title}
                                    onChange={handleChange}
                                    className="w-full border border-gold/20 bg-white p-4 font-body text-sm text-primary shadow-sm focus:border-primary focus:outline-none"
                                    placeholder="Tieu de SEO hien thi tren Google"
                                />
                            </div>

                            <div className="space-y-2 md:col-span-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">SEO Description</label>
                                <textarea
                                    name="meta_description"
                                    value={formData.meta_description}
                                    onChange={handleChange}
                                    rows="3"
                                    className="w-full resize-none border border-gold/20 bg-white p-4 font-body text-sm text-primary shadow-sm focus:border-primary focus:outline-none"
                                    placeholder="Mo ta SEO ngan gon, ro y va hap dan"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">SEO Keywords</label>
                                <textarea
                                    name="meta_keywords"
                                    value={formData.meta_keywords}
                                    onChange={handleChange}
                                    rows="3"
                                    className="w-full resize-none border border-gold/20 bg-white p-4 font-body text-sm text-primary shadow-sm focus:border-primary focus:outline-none"
                                    placeholder="keyword 1, keyword 2, keyword 3"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="mb-1 flex items-center justify-between">
                                <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-stone">Nội Dung Chi Tiết</label>
                                <button
                                    type="button"
                                    onClick={handleAIGenerate}
                                    disabled={aiGenerating || !aiAvailable}
                                    className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-[9px] font-bold uppercase tracking-widest shadow-sm transition-all ${aiGenerating
                                        ? 'cursor-wait animate-pulse bg-gold/10 text-gold'
                                        : !aiAvailable
                                            ? 'cursor-not-allowed bg-stone-300 text-stone-100'
                                            : 'bg-gradient-to-r from-primary to-umber text-white hover:scale-105 active:scale-95'
                                        }`}
                                    title={!aiAvailable ? disabledReason : 'Tạo tiêu đề và nội dung bằng AI'}
                                >
                                    <span className={`material-symbols-outlined text-xs ${aiGenerating ? 'animate-spin' : ''}`}>
                                        {aiGenerating ? 'progress_activity' : 'auto_awesome'}
                                    </span>
                                    {aiGenerating ? 'Đang viết bài...' : 'Viết bằng AI'}
                                </button>
                            </div>

                            <div className="mb-2 flex flex-wrap justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={handleCopyContentHtml}
                                    className="flex items-center gap-2 rounded-sm border border-gold/20 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-gold shadow-sm transition hover:bg-gold/5 active:scale-95"
                                    title="Copy HTML bài viết để gửi sang ChatGPT"
                                >
                                    <span className="material-symbols-outlined text-[14px]">content_copy</span>
                                    Copy HTML
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setContentHtmlPasteOpen(true)}
                                    className="flex items-center gap-2 rounded-sm border border-primary/20 px-3 py-1.5 text-[9px] font-bold uppercase tracking-widest text-primary shadow-sm transition hover:bg-primary/5 active:scale-95"
                                    title="Dán HTML bài viết đã được ChatGPT viết lại"
                                >
                                    <span className="material-symbols-outlined text-[14px]">code_blocks</span>
                                    Dán HTML
                                </button>
                            </div>

                            {!aiAvailable ? (
                                <p className="text-[11px] italic text-amber-700">{disabledReason}</p>
                            ) : null}

                            <p className="text-[11px] italic text-stone/55">
                                Bấm trực tiếp vào ảnh trong editor để thay ảnh, sửa tên ảnh hoặc chỉnh mô tả alt/title.
                            </p>

                            <div
                                className="quill-premium-wrapper border border-gold/20 bg-white shadow-sm"
                                onClickCapture={handleEditorClickCapture}
                                onKeyDownCapture={handleEditorKeyDownCapture}
                                onDragStartCapture={handleEditorDragStartCapture}
                                onDragOverCapture={handleEditorDragOverCapture}
                                onDropCapture={handleEditorDropCapture}
                                onDragEndCapture={handleEditorDragEndCapture}
                            >
                                <ReactQuill
                                    ref={quillRef}
                                    theme="snow"
                                    value={formData.content}
                                    onChange={(content) => {
                                        const nextContent = content || '';

                                        setFormData((prev) => (
                                            nextContent === prev.content
                                                ? prev
                                                : { ...prev, content: nextContent }
                                        ));
                                    }}
                                    modules={quillModulesRef.current}
                                    formats={QUILL_FORMATS}
                                    className="font-body text-lg"
                                    style={{ height: '500px', marginBottom: '50px' }}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-8 lg:col-span-4">
                        <div className="space-y-6 border border-gold/20 bg-white p-6 shadow-premium">
                            <div className="space-y-4">
                                <label className="font-ui flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary">
                                    <span className="material-symbols-outlined text-xs">image</span>
                                    Ảnh Đại Diện
                                </label>

                                <div className="group relative flex aspect-[16/9] w-full items-center justify-center overflow-hidden border-2 border-dashed border-gold/20 bg-gold/5">
                                    {featuredImagePreviewUrl ? (
                                        <>
                                            <img src={featuredImagePreviewUrl} className="h-full w-full object-cover" alt="Preview" />
                                            <div className="absolute inset-0 flex items-center justify-center gap-4 bg-primary/40 opacity-0 transition-opacity group-hover:opacity-100">
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData((prev) => ({ ...prev, featured_image: '' }))}
                                                    className="rounded-full bg-white/90 p-2 text-brick transition-transform hover:scale-110"
                                                >
                                                    <span className="material-symbols-outlined text-sm">delete</span>
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="space-y-2 p-6 text-center">
                                            <span className="material-symbols-outlined text-3xl text-gold opacity-40">add_photo_alternate</span>
                                            <p className="font-ui text-[10px] uppercase tracking-widest text-stone">Chưa có ảnh đại diện</p>
                                        </div>
                                    )}
                                </div>

                                <input
                                    type="text"
                                    name="featured_image"
                                    value={formData.featured_image}
                                    onChange={handleChange}
                                    className="w-full border border-gold/10 bg-gold/5 p-3 font-body text-xs italic focus:border-primary focus:outline-none"
                                    placeholder="Dán URL ảnh tại đây..."
                                />

                                <label className={`inline-flex cursor-pointer items-center gap-2 border px-4 py-3 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors ${uploadingFeaturedImage ? 'border-gold/20 bg-primary/5 text-primary/50' : 'border-gold/20 text-primary hover:border-primary hover:bg-primary hover:text-white'}`}>
                                    <span className="material-symbols-outlined text-[18px]">{uploadingFeaturedImage ? 'progress_activity' : 'upload_file'}</span>
                                    {uploadingFeaturedImage ? 'Đang tải ảnh đại diện...' : 'Upload ảnh đại diện'}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleFeaturedImageUpload}
                                        disabled={uploadingFeaturedImage}
                                    />
                                </label>
                            </div>

                            <div className="h-px bg-gold/10"></div>

                            <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Trạng Thái Đăng</label>
                                    <label className="relative inline-flex cursor-pointer items-center">
                                        <input
                                            type="checkbox"
                                            name="is_published"
                                            checked={formData.is_published}
                                            onChange={handleChange}
                                            className="peer sr-only"
                                        />
                                        <div className="after:content-[''] w-11 rounded-full bg-stone/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:bg-white after:transition-all peer-checked:bg-gold peer-checked:after:translate-x-full h-6"></div>
                                    </label>
                                </div>

                                <div className="flex items-center justify-between">
                                    <label className="font-ui text-[10px] font-bold uppercase tracking-widest text-primary">Đánh Dấu Sao</label>
                                    <label className="relative inline-flex cursor-pointer items-center">
                                        <input
                                            type="checkbox"
                                            name="is_starred"
                                            checked={formData.is_starred}
                                            onChange={handleChange}
                                            className="peer sr-only"
                                        />
                                        <div className="after:content-[''] w-11 rounded-full bg-stone/20 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:bg-white after:transition-all peer-checked:bg-gold peer-checked:after:translate-x-full h-6"></div>
                                    </label>
                                </div>

                                <div className="space-y-3">
                                    <label className="font-ui flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-primary">
                                        <span className="material-symbols-outlined text-xs">schedule</span>
                                        Lịch Đăng (Tùy chọn)
                                    </label>
                                    <input
                                        type="date"
                                        name="published_at"
                                        value={formData.published_at}
                                        onChange={handleChange}
                                        className="w-full border border-gold/10 bg-gold/5 p-3 font-ui text-[10px] font-bold uppercase tracking-widest focus:border-primary focus:outline-none"
                                    />
                                    <p className="text-[9px] italic text-stone">De trong neu muon hien thi ngay sau khi bat Trạng Thái Đăng.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </form>

            {mediaModalState.open ? (
                <BlogMediaGalleryModal
                    open={mediaModalState.open}
                    initialItems={mediaModalState.items}
                    editing={mediaModalState.editing}
                    onClose={closeMediaModal}
                    onSave={handleSaveMediaGallery}
                    onRemoveBlock={mediaModalState.editing ? handleRemoveMediaGallery : null}
                />
            ) : null}

            {inlineImageModalState.open ? (
                <BlogInlineImageModal
                    open={inlineImageModalState.open}
                    initialImage={inlineImageModalState.image}
                    editing={inlineImageModalState.editing}
                    onClose={closeInlineImageModal}
                    onSave={handleSaveInlineImage}
                    onRemove={inlineImageModalState.editing ? handleRemoveInlineImage : null}
                />
            ) : null}

            <ProductDescriptionHtmlPasteModal
                open={contentHtmlPasteOpen}
                initialHtml={getCurrentContentHtml()}
                onApply={handleApplyContentHtmlPaste}
                onClose={() => setContentHtmlPasteOpen(false)}
            />

            <BlogPostBulkPasteModal
                open={bulkPasteOpen}
                onApply={handleApplyFullPostPaste}
                onClose={() => setBulkPasteOpen(false)}
            />
        </>
    );
};

export default BlogForm;
